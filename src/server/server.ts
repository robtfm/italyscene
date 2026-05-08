import {
  engine,
  Entity,
  Name,
  PlayerIdentityData,
  Transform,
  MeshRenderer,
  MeshCollider,
  Material,
  Tween,
  ColliderLayer,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { Storage } from '@dcl/sdk/server'
import { Brick, BuildingState, WorldState } from '../shared/schemas'
import { room } from '../shared/messages'
import {
  BUILDING_CONFIGS,
  BuildingConfig,
  bricksRequiredFor,
  brickStraightenFor,
} from '../shared/buildings'
import { spawnPlaceholderBuildings } from '../shared/building-spawn'
import {
  brickCapMultiplier,
  contributionPersonalBonus,
  contributionTeacherBonus,
  gateBlockingFor,
  harmonicSum,
  isAtEffectiveMax,
  leanRateScale,
  levelUpCost,
  plumbLinePersonalBonus,
  plumbLineTeacherBonus,
  rollBrickValue,
  spawnIntervalScale,
  sturdyAngleBonus,
  titheBonus,
  UPGRADE_GATES,
} from '../shared/upgrades'

const SCENE_SIZE = 80
const SPAWN_AREA = { x: 0, z: 0, clear: 9 }

const BRICK_SPAWN_INTERVAL_S = 5
const MAX_ACTIVE_BRICKS = 8
const BRICK_HOVER_HEIGHT = 1.2


let worldStateEntity: Entity | null = null
let timeSinceSpawn = 0
let nextBrickId = 1
const currentRoundContributors = new Set<string>()

type PlayerProfile = {
  lifetimeContributions: number
  // Linear unlock counter scanning the (building × level) grid row-by-row.
  //   0 → only Pisa Lv 1, 1 → +Colosseum Lv 1, ...
  //   N (== BUILDING_CONFIGS.length) → +Pisa Lv 2, etc.
  // The "highest unlocked level" is floor(availableBuildings / N); the next
  // building to unlock is tier (availableBuildings % N) + 1 at that level + 1.
  availableBuildings: number
  // Highest level personally beaten of each building (0 = never). Skill /
  // unlock gates check this map (e.g., maxBuildingLevel.Colosseum >= 4).
  // Increments by 1 (capped at completedLevel) each time the player
  // participates in beating that building at or above their current max.
  maxBuildingLevel: Record<string, number>
  bricksSpent: number
  // Pity counter: +1 per pick where the rolled building's level wouldn't
  // advance this player's availableBuildings (or unlock something they want).
  // Resets to 0 when it would. Their per-building contribution to the
  // weighted pick is (pity + 1).
  pity: number
  multiBricksLevel: number
  pickupRadiusLevel: number
  fasterSpawnsLevel: number
  leanDampenerLevel: number
  sturdyFoundationLevel: number
  plumbLineLevel: number
  plumbTeacherLevel: number
  generousLevel: number
  generousTeacherLevel: number
  stockpileLevel: number
  titheLevel: number
}
const PROFILE_KEY = 'profile'
const WORLD_KEY = 'worldState'
const COMPLETION_CELEBRATION_S = 10
const WORLD_SAVE_INTERVAL_S = 3
const FAST_FORWARD_CAP_S = 30 * 60

type SerializedWorldState = {
  brickCount: number
  currentBuildingKey: string
  nextBrickId: number
  contributors: string[]
  building: {
    riseProgress: number
    currentLean: number
    collapsing: boolean
    collapseTime: number
    collapseStartProgress: number
    completedTime: number
  }
  // Persistent per-building progression level, keyed by buildingKey
  // (every entry survives across server restarts and building rotations).
  buildingLevels?: Record<string, number>
  savedAt: number // Date.now() ms
}
const profilePromises = new Map<string, Promise<PlayerProfile>>()
const greetedEntities = new Set<Entity>()

function defaultProfile(): PlayerProfile {
  return {
    lifetimeContributions: 0,
    availableBuildings: 0,
    maxBuildingLevel: {},
    bricksSpent: 0,
    pity: 0,
    multiBricksLevel: 0,
    pickupRadiusLevel: 0,
    fasterSpawnsLevel: 0,
    leanDampenerLevel: 0,
    sturdyFoundationLevel: 0,
    plumbLineLevel: 0,
    plumbTeacherLevel: 0,
    generousLevel: 0,
    generousTeacherLevel: 0,
    stockpileLevel: 0,
    titheLevel: 0,
  }
}

async function loadProfile(address: string): Promise<PlayerProfile> {
  try {
    const raw = await Storage.player.get<string>(address, PROFILE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.lifetimeContributions === 'number') {
        // Migrate legacy unlockedTier (1-indexed, monotonic) to availableBuildings:
        // unlockedTier=1 → 0 (just Pisa), unlockedTier=2 → 1 (+Colosseum), etc.
        const legacyAvailable =
          typeof parsed.unlockedTier === 'number' ? parsed.unlockedTier - 1 : 0
        return {
          lifetimeContributions: parsed.lifetimeContributions,
          availableBuildings: parsed.availableBuildings ?? legacyAvailable,
          maxBuildingLevel: parsed.maxBuildingLevel ?? {},
          bricksSpent: parsed.bricksSpent ?? 0,
          pity: parsed.pity ?? 0,
          multiBricksLevel: parsed.multiBricksLevel ?? 0,
          pickupRadiusLevel: parsed.pickupRadiusLevel ?? 0,
          fasterSpawnsLevel: parsed.fasterSpawnsLevel ?? 0,
          leanDampenerLevel: parsed.leanDampenerLevel ?? 0,
          sturdyFoundationLevel: parsed.sturdyFoundationLevel ?? 0,
          plumbLineLevel: parsed.plumbLineLevel ?? 0,
          plumbTeacherLevel: parsed.plumbTeacherLevel ?? 0,
          generousLevel: parsed.generousLevel ?? 0,
          generousTeacherLevel: parsed.generousTeacherLevel ?? 0,
          stockpileLevel: parsed.stockpileLevel ?? 0,
          titheLevel: parsed.titheLevel ?? 0,
        }
      }
    }
  } catch (e) {
    console.log('[SERVER] loadProfile error', address, e)
  }
  return defaultProfile()
}

async function saveProfile(address: string, profile: PlayerProfile) {
  try {
    await Storage.player.set(address, PROFILE_KEY, JSON.stringify(profile))
  } catch (e) {
    console.log('[SERVER] saveProfile error', address, e)
  }
}

function ensureProfile(address: string): Promise<PlayerProfile> {
  if (!profilePromises.has(address)) {
    profilePromises.set(address, loadProfile(address))
  }
  return profilePromises.get(address)!
}

async function loadWorldState(): Promise<SerializedWorldState | null> {
  try {
    const data = await Storage.get<SerializedWorldState>(WORLD_KEY)
    return data ?? null
  } catch (e) {
    console.log('[SERVER] loadWorldState error', e)
    return null
  }
}

async function saveWorldState() {
  if (!worldStateEntity) return
  const ws = WorldState.get(worldStateEntity)
  const activeEntity = findBuildingStateEntity(ws.currentBuildingKey)
  if (!activeEntity) return
  const bs = BuildingState.get(activeEntity)
  const buildingLevels: Record<string, number> = {}
  for (const [_, s] of engine.getEntitiesWith(BuildingState)) {
    buildingLevels[s.buildingKey] = s.level
  }
  const data: SerializedWorldState = {
    brickCount: ws.brickCount,
    currentBuildingKey: ws.currentBuildingKey,
    nextBrickId,
    contributors: [...currentRoundContributors],
    building: {
      riseProgress: bs.riseProgress,
      currentLean: bs.currentLean,
      collapsing: bs.collapsing,
      collapseTime: bs.collapseTime,
      collapseStartProgress: bs.collapseStartProgress,
      completedTime: bs.completedTime,
    },
    buildingLevels,
    savedAt: Date.now(),
  }
  try {
    await Storage.set(WORLD_KEY, data)
  } catch (e) {
    console.log('[SERVER] saveWorldState error', e)
  }
}

async function restoreWorldState() {
  const saved = await loadWorldState()
  if (!saved) {
    console.log('[SERVER] No persisted world state — starting fresh')
    return
  }
  if (!worldStateEntity) return

  const ws = WorldState.getMutable(worldStateEntity)
  ws.brickCount = saved.brickCount
  ws.currentBuildingKey = saved.currentBuildingKey
  nextBrickId = Math.max(nextBrickId, saved.nextBrickId)
  for (const a of saved.contributors) currentRoundContributors.add(a)

  // Restore per-building levels (older saves may not have this field).
  if (saved.buildingLevels) {
    for (const [entity, s] of engine.getEntitiesWith(BuildingState)) {
      const persisted = saved.buildingLevels[s.buildingKey]
      if (typeof persisted === 'number') {
        BuildingState.getMutable(entity).level = persisted
      }
    }
  }

  const activeEntity = findBuildingStateEntity(saved.currentBuildingKey)
  if (activeEntity) {
    const bs = BuildingState.getMutable(activeEntity)
    bs.riseProgress = saved.building.riseProgress
    bs.currentLean = saved.building.currentLean
    bs.collapsing = saved.building.collapsing
    bs.collapseTime = saved.building.collapseTime
    bs.collapseStartProgress = saved.building.collapseStartProgress
    bs.completedTime = saved.building.completedTime
  }

  const elapsedSec = Math.min(
    FAST_FORWARD_CAP_S,
    Math.max(0, (Date.now() - saved.savedAt) / 1000)
  )
  console.log(
    '[SERVER] Restored world state, fast-forwarding',
    elapsedSec.toFixed(1),
    's'
  )
  fastForward(elapsedSec)
}

function fastForward(totalSec: number) {
  const STEP = 0.5
  let remaining = totalSec
  while (remaining > 0) {
    const dt = Math.min(STEP, remaining)
    serverBuildingSystem(dt)
    remaining -= dt
  }
}

let worldSaveTimer = 0
function worldSaveSystem(dt: number) {
  worldSaveTimer += dt
  if (worldSaveTimer < WORLD_SAVE_INTERVAL_S) return
  worldSaveTimer = 0
  void saveWorldState()
}

type NextEffectives = {
  nextEffectiveMultiBricksLevel: number
  nextEffectiveFasterSpawnsLevel: number
  nextEffectiveLeanDampenerLevel: number
  nextEffectiveSturdyFoundationLevel: number
  nextEffectivePlumbTeacherLevel: number
  nextEffectiveGenerousTeacherLevel: number
  nextEffectiveStockpileLevel: number
}
const ZERO_NEXT_EFFECTIVES: NextEffectives = {
  nextEffectiveMultiBricksLevel: 0,
  nextEffectiveFasterSpawnsLevel: 0,
  nextEffectiveLeanDampenerLevel: 0,
  nextEffectiveSturdyFoundationLevel: 0,
  nextEffectivePlumbTeacherLevel: 0,
  nextEffectiveGenerousTeacherLevel: 0,
  nextEffectiveStockpileLevel: 0,
}
// Cache of the most-recent personalised "next effective" per player.
// Refreshed by recomputeEffectiveLevelAsync (~1Hz). sendMyStats reuses it so
// brick-collect and level-up paths don't re-walk every present player.
const lastNextEffectives = new Map<string, NextEffectives>()

function sendMyStats(rawAddress: string, profile: PlayerProfile) {
  const next =
    lastNextEffectives.get(rawAddress.toLowerCase()) ?? ZERO_NEXT_EFFECTIVES
  room.send(
    'myStatsUpdate',
    {
      lifetimeContributions: profile.lifetimeContributions,
      bricksSpent: profile.bricksSpent,
      multiBricksLevel: profile.multiBricksLevel,
      pickupRadiusLevel: profile.pickupRadiusLevel,
      fasterSpawnsLevel: profile.fasterSpawnsLevel,
      leanDampenerLevel: profile.leanDampenerLevel,
      sturdyFoundationLevel: profile.sturdyFoundationLevel,
      plumbLineLevel: profile.plumbLineLevel,
      plumbTeacherLevel: profile.plumbTeacherLevel,
      generousLevel: profile.generousLevel,
      generousTeacherLevel: profile.generousTeacherLevel,
      stockpileLevel: profile.stockpileLevel,
      titheLevel: profile.titheLevel,
      maxBuildingLevelJson: JSON.stringify(profile.maxBuildingLevel),
      ...next,
    },
    { to: [rawAddress] }
  )
}

async function initPlayer(rawAddress: string) {
  const address = rawAddress.toLowerCase()
  const profile = await ensureProfile(address)
  sendMyStats(rawAddress, profile)
}

function playerJoinSystem() {
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (greetedEntities.has(entity)) continue
    greetedEntities.add(entity)
    void initPlayer(identity.address)
  }
}

export async function initServer() {
  console.log('[SERVER] initServer')

  spawnPlaceholderBuildings()

  worldStateEntity = engine.addEntity()
  WorldState.create(worldStateEntity, {
    brickCount: 0,
    currentBuildingKey: BUILDING_CONFIGS[0].entityName,
  })
  syncEntity(worldStateEntity, [WorldState.componentId])

  for (const cfg of BUILDING_CONFIGS) {
    attachBuildingState(cfg)
  }

  await restoreWorldState()

  room.onMessage('collectBrick', (data, context) => {
    if (!context) return
    void handleCollectBrick(data.brickId, context.from)
  })

  room.onMessage('debugAddBrick', (_data, context) => {
    if (!context) return
    void applyBrickAward(context.from, 1)
  })

  room.onMessage('levelUpMultiBricks', (_data, context) => {
    if (context) void handleLevelUp(context.from, 'multiBricksLevel')
  })
  room.onMessage('levelUpPickupRadius', (_data, context) => {
    if (context) void handleLevelUp(context.from, 'pickupRadiusLevel')
  })
  room.onMessage('levelUpFasterSpawns', (_data, context) => {
    if (context) void handleLevelUp(context.from, 'fasterSpawnsLevel')
  })
  room.onMessage('levelUpLeanDampener', (_data, context) => {
    if (context) void handleLevelUp(context.from, 'leanDampenerLevel')
  })
  room.onMessage('levelUpSturdyFoundation', (_data, context) => {
    if (context) void handleLevelUp(context.from, 'sturdyFoundationLevel')
  })
  room.onMessage('levelUpPlumbLine', (_data, context) => {
    if (context) void handleLevelUp(context.from, 'plumbLineLevel')
  })
  room.onMessage('levelUpPlumbTeacher', (_data, context) => {
    if (context) void handleLevelUp(context.from, 'plumbTeacherLevel')
  })
  room.onMessage('levelUpGenerous', (_data, context) => {
    if (context) void handleLevelUp(context.from, 'generousLevel')
  })
  room.onMessage('levelUpGenerousTeacher', (_data, context) => {
    if (context) void handleLevelUp(context.from, 'generousTeacherLevel')
  })
  room.onMessage('levelUpStockpile', (_data, context) => {
    if (context) void handleLevelUp(context.from, 'stockpileLevel')
  })
  room.onMessage('levelUpTithe', (_data, context) => {
    if (context) void handleLevelUp(context.from, 'titheLevel')
  })

  engine.addSystem(brickSpawnSystem)
  engine.addSystem(serverBuildingSystem)
  engine.addSystem(playerJoinSystem)
  engine.addSystem(worldSaveSystem)
  engine.addSystem(effectiveLevelSystem)
}

function attachBuildingState(cfg: BuildingConfig) {
  const stateEntity = engine.addEntity()
  BuildingState.create(stateEntity, {
    buildingKey: cfg.entityName,
    level: 0,
    riseProgress: 0,
    currentLean: 0,
    collapsing: false,
    collapseTime: 0,
    collapseStartProgress: 0,
    baseGroundY: 0,
    baseInitialized: false,
    completedTime: 0,
  })
  syncEntity(stateEntity, [BuildingState.componentId])
}

function findBuildingStateEntity(buildingKey: string): Entity | null {
  for (const [entity, state] of engine.getEntitiesWith(BuildingState)) {
    if (state.buildingKey === buildingKey) return entity
  }
  return null
}

const MAX_SPAWNS_PER_TICK = 50

function brickSpawnSystem(dt: number) {
  // Effective interval is shorter when the world has Faster Spawns levels.
  // Effective cap is larger when the world has Stockpile levels.
  const ws = worldStateEntity ? WorldState.get(worldStateEntity) : null
  const interval =
    BRICK_SPAWN_INTERVAL_S *
    (ws ? spawnIntervalScale(ws.effectiveFasterSpawnsLevel) : 1)
  const cap = ws
    ? Math.round(MAX_ACTIVE_BRICKS * brickCapMultiplier(ws.effectiveStockpileLevel))
    : MAX_ACTIVE_BRICKS
  // While at cap, freeze the timer entirely so the next spawn after a brick
  // is collected waits a full interval rather than firing instantly.
  if (countActiveBricks() >= cap) {
    timeSinceSpawn = 0
    return
  }
  // Edge case: zero or negative interval -> one per tick (prevents infinite loop)
  if (interval <= 0) {
    spawnBrick()
    return
  }
  timeSinceSpawn += dt
  let spawned = 0
  while (timeSinceSpawn >= interval && spawned < MAX_SPAWNS_PER_TICK) {
    if (countActiveBricks() >= cap) {
      timeSinceSpawn = 0
      return
    }
    timeSinceSpawn -= interval
    spawnBrick()
    spawned++
  }
}

function countActiveBricks() {
  let n = 0
  for (const _ of engine.getEntitiesWith(Brick)) n++
  return n
}

type Hill = { x: number; y: number; z: number; sx: number; sy: number; sz: number }
let hillsCache: Hill[] | null = null

function getHills(): Hill[] {
  if (hillsCache) return hillsCache
  const list: Hill[] = []
  for (const [entity] of engine.getEntitiesWith(Transform, Name)) {
    const nm = Name.getOrNull(entity)?.value || ''
    if (!nm.startsWith('Hill_') && !nm.startsWith('BigHill_')) continue
    const t = Transform.get(entity)
    list.push({
      x: t.position.x,
      y: t.position.y,
      z: t.position.z,
      sx: t.scale.x,
      sy: t.scale.y,
      sz: t.scale.z,
    })
  }
  if (list.length === 0) return list
  hillsCache = list
  console.log('[SERVER] Cached', list.length, 'hills for height lookup')
  return list
}

function hillHeightAt(x: number, z: number): number {
  let maxY = 0
  for (const h of getHills()) {
    const dx = (x - h.x) / (h.sx / 2)
    const dz = (z - h.z) / (h.sz / 2)
    const r2 = dx * dx + dz * dz
    if (r2 < 1) {
      const y = h.y + (h.sy / 2) * Math.sqrt(1 - r2)
      if (y > maxY) maxY = y
    }
  }
  return maxY
}

function spawnBrick() {
  let x = 0
  let z = 0
  for (let i = 0; i < 30; i++) {
    x = 2 + Math.random() * (SCENE_SIZE - 4)
    z = 2 + Math.random() * (SCENE_SIZE - 4)
    if (Math.hypot(x - SPAWN_AREA.x, z - SPAWN_AREA.z) < SPAWN_AREA.clear) continue
    break
  }
  const groundY = hillHeightAt(x, z)
  const eff = worldStateEntity
    ? WorldState.get(worldStateEntity).effectiveMultiBricksLevel
    : 0
  const value = rollBrickValue(eff)
  createBrickEntity(x, groundY + BRICK_HOVER_HEIGHT, z, value)
}

function createBrickEntity(x: number, y: number, z: number, value: number) {
  const entity = engine.addEntity()
  const brickId = nextBrickId++
  Brick.create(entity, { brickId, value, spawnedAt: Date.now() })
  // Visual height grows with stack value but caps so towers stay clickable.
  const visualY = Math.min(3, 0.5 * value)
  Transform.create(entity, {
    position: { x, y, z },
    scale: { x: 0.8, y: visualY, z: 1.2 },
    rotation: { x: 0, y: Math.random() * Math.PI * 2, z: 0, w: 1 },
  })
  MeshRenderer.setBox(entity)
  MeshCollider.setBox(entity, ColliderLayer.CL_POINTER)
  const palette =
    value >= 8
      ? {
          // jewel — bright emerald-violet for huge stacks
          albedo: Color4.fromHexString('#9f4cffff'),
          emissive: Color4.fromHexString('#5a1ec0ff'),
          emissiveIntensity: 2.0,
        }
      : value >= 4
      ? {
          albedo: Color4.fromHexString('#e6b94dff'),
          emissive: Color4.fromHexString('#b07a14ff'),
          emissiveIntensity: 1.4,
        }
      : value >= 2
      ? {
          albedo: Color4.fromHexString('#d96a30ff'),
          emissive: Color4.fromHexString('#993315ff'),
          emissiveIntensity: 1.0,
        }
      : {
          albedo: Color4.fromHexString('#c2522dff'),
          emissive: Color4.fromHexString('#7a2a14ff'),
          emissiveIntensity: 0.6,
        }
  Material.setPbrMaterial(entity, {
    albedoColor: palette.albedo,
    roughness: 0.85,
    metallic: 0.0,
    emissiveColor: palette.emissive,
    emissiveIntensity: palette.emissiveIntensity,
  })
  // direction sets axis (Y); speed is degrees/sec. 60°/s = full revolution per 6s.
  Tween.setRotateContinuous(entity, Quaternion.fromEulerDegrees(0, 1, 0), 60)
  syncEntity(entity, [
    Transform.componentId,
    Brick.componentId,
    MeshRenderer.componentId,
    Material.componentId,
    MeshCollider.componentId,
    Tween.componentId,
  ])
}

async function handleCollectBrick(brickId: number, playerAddress: string) {
  for (const [entity, b] of engine.getEntitiesWith(Brick)) {
    if (b.brickId !== brickId) continue
    const value = b.value || 1
    await applyBrickAward(playerAddress, value)
    engine.removeEntity(entity)
    return
  }
  console.log('[SERVER] collectBrick: no entity with brickId', brickId)
}

async function applyBrickAward(playerAddress: string, baseValue: number) {
  const address = playerAddress.toLowerCase()
  const profile = await ensureProfile(address)
  const ws = worldStateEntity ? WorldState.get(worldStateEntity) : null
  const personalContrib = contributionPersonalBonus(profile.generousLevel)
  const teacherContrib = ws
    ? contributionTeacherBonus(ws.effectiveGenerousTeacherLevel)
    : 0
  const valueMult = 1 + personalContrib + teacherContrib
  // Generous boosts ONLY the building progress (brickCount), not the player's
  // lifetime currency. Otherwise it snowballs into self-funding upgrades.
  const buildingValue = Math.max(baseValue, Math.round(baseValue * valueMult))

  const personalStraightenFrac = plumbLinePersonalBonus(profile.plumbLineLevel)
  const teacherStraightenFrac = ws
    ? plumbLineTeacherBonus(ws.effectivePlumbTeacherLevel)
    : 0
  // Plumb Line / Maestro multiply the building's per-brick straighten
  // (instead of adding flat degrees) so they stay coupled to the per-building
  // scaling and can't outrun a difficult building's design.
  const straightenMultiplier =
    1 + personalStraightenFrac + teacherStraightenFrac

  // Tithe (personal) multiplies only the upgrade-currency credit, not the
  // building progress.
  const tithe = titheBonus(profile.titheLevel)
  const creditValue = Math.max(baseValue, Math.round(baseValue * (1 + tithe)))

  incrementBrickCount(buildingValue, straightenMultiplier)
  creditPlayer(playerAddress, creditValue)
}

async function creditPlayer(rawAddress: string, amount: number) {
  const address = rawAddress.toLowerCase()
  currentRoundContributors.add(address)
  const profile = await ensureProfile(address)
  profile.lifetimeContributions += amount
  void saveProfile(address, profile)
  sendMyStats(rawAddress, profile)
}

type UpgradeKey =
  | 'multiBricksLevel'
  | 'pickupRadiusLevel'
  | 'fasterSpawnsLevel'
  | 'leanDampenerLevel'
  | 'sturdyFoundationLevel'
  | 'plumbLineLevel'
  | 'plumbTeacherLevel'
  | 'generousLevel'
  | 'generousTeacherLevel'
  | 'stockpileLevel'
  | 'titheLevel'

async function handleLevelUp(rawAddress: string, key: UpgradeKey) {
  const address = rawAddress.toLowerCase()
  const profile = await ensureProfile(address)
  const current = profile[key]
  if (isAtEffectiveMax(key, current, profile.maxBuildingLevel)) return
  const cost = levelUpCost(current, key)
  const available = profile.lifetimeContributions - profile.bricksSpent
  if (available < cost) return
  profile.bricksSpent += cost
  profile[key] = current + 1
  void saveProfile(address, profile)
  sendMyStats(rawAddress, profile)
  console.log('[SERVER]', address, 'leveled up', key, '->', profile[key])
}

let effectiveLevelTimer = 0
let effectiveLevelInFlight = false

function effectiveLevelSystem(dt: number) {
  effectiveLevelTimer += dt
  if (effectiveLevelTimer < 1) return
  effectiveLevelTimer = 0
  if (effectiveLevelInFlight) return
  effectiveLevelInFlight = true
  void recomputeEffectiveLevelAsync().finally(() => {
    effectiveLevelInFlight = false
  })
}

async function recomputeEffectiveLevelAsync() {
  if (!worldStateEntity) return
  type Entry = { rawAddress: string; profile: PlayerProfile }
  const players: Entry[] = []
  for (const [_, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const profile = await ensureProfile(identity.address.toLowerCase())
    players.push({ rawAddress: identity.address, profile })
  }
  const mb = players.map((p) => p.profile.multiBricksLevel)
  const fs = players.map((p) => p.profile.fasterSpawnsLevel)
  const ld = players.map((p) => p.profile.leanDampenerLevel)
  const sf = players.map((p) => p.profile.sturdyFoundationLevel)
  const pt = players.map((p) => p.profile.plumbTeacherLevel)
  const gt = players.map((p) => p.profile.generousTeacherLevel)
  const sp = players.map((p) => p.profile.stockpileLevel)
  const ws = WorldState.getMutableOrNull(worldStateEntity)
  if (!ws) return
  const setIfChanged = (cur: number, next: number, apply: (v: number) => void) => {
    if (Math.abs(cur - next) > 0.001) apply(next)
  }
  setIfChanged(ws.effectiveMultiBricksLevel, harmonicSum(mb), (v) => {
    ws.effectiveMultiBricksLevel = v
  })
  setIfChanged(ws.effectiveFasterSpawnsLevel, harmonicSum(fs), (v) => {
    ws.effectiveFasterSpawnsLevel = v
  })
  setIfChanged(ws.effectiveLeanDampenerLevel, harmonicSum(ld), (v) => {
    ws.effectiveLeanDampenerLevel = v
  })
  setIfChanged(ws.effectiveSturdyFoundationLevel, harmonicSum(sf), (v) => {
    ws.effectiveSturdyFoundationLevel = v
  })
  setIfChanged(ws.effectivePlumbTeacherLevel, harmonicSum(pt), (v) => {
    ws.effectivePlumbTeacherLevel = v
  })
  setIfChanged(ws.effectiveGenerousTeacherLevel, harmonicSum(gt), (v) => {
    ws.effectiveGenerousTeacherLevel = v
  })
  setIfChanged(ws.effectiveStockpileLevel, harmonicSum(sp), (v) => {
    ws.effectiveStockpileLevel = v
  })

  // Per-player: compute "what would the harmonic effective be if I were +1?"
  // for each global skill, then push a personalised myStats update so the
  // client's skill-tree button hover can show an honest "Next" value.
  for (let i = 0; i < players.length; i++) {
    const p = players[i]
    const next: NextEffectives = {
      nextEffectiveMultiBricksLevel: harmonicSumWithBumped(mb, i),
      nextEffectiveFasterSpawnsLevel: harmonicSumWithBumped(fs, i),
      nextEffectiveLeanDampenerLevel: harmonicSumWithBumped(ld, i),
      nextEffectiveSturdyFoundationLevel: harmonicSumWithBumped(sf, i),
      nextEffectivePlumbTeacherLevel: harmonicSumWithBumped(pt, i),
      nextEffectiveGenerousTeacherLevel: harmonicSumWithBumped(gt, i),
      nextEffectiveStockpileLevel: harmonicSumWithBumped(sp, i),
    }
    lastNextEffectives.set(p.rawAddress.toLowerCase(), next)
    sendMyStats(p.rawAddress, p.profile)
  }
}

function harmonicSumWithBumped(levels: number[], i: number): number {
  const copy = [...levels]
  copy[i] = copy[i] + 1
  return harmonicSum(copy)
}

function presentPlayerAddresses(): Set<string> {
  const present = new Set<string>()
  for (const [_, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    present.add(identity.address.toLowerCase())
  }
  return present
}

async function handleBuildingCollapse(cfg: BuildingConfig) {
  console.log('[SERVER] Building collapsed:', cfg.entityName, '— hard repick')
  const next = await pickNextBuildingKey(cfg.entityName)
  await transitionToBuilding(next, cfg)
}

async function handleBuildingCompletion(cfg: BuildingConfig) {
  const present = presentPlayerAddresses()
  const eligible = [...currentRoundContributors].filter((a) => present.has(a))

  // Level just beaten — read BEFORE we bump the building's persistent level.
  const completedEntity = findBuildingStateEntity(cfg.entityName)
  const completedLevel = completedEntity
    ? BuildingState.get(completedEntity).level
    : 0

  // Credit eligible players' profiles. Both progressions cap at +1 per
  // completion: a low-tier player who joins a high-level party advances by
  // one rung in each track, not all the way to the completed level —
  // preserves the granularity for skill / building unlocks gated on
  // per-building max levels (e.g., "beat Colosseum L4+").
  for (const address of eligible) {
    const profile = await ensureProfile(address)

    const currentMax = profile.maxBuildingLevel[cfg.entityName] ?? 0
    if (completedLevel >= currentMax) {
      profile.maxBuildingLevel[cfg.entityName] = currentMax + 1
    }
    if (completedLevel >= highestUnlockedLevel(profile)) {
      profile.availableBuildings += 1
    }

    void saveProfile(address, profile)
  }

  console.log(
    '[SERVER] Building completed:',
    cfg.entityName,
    '— Lv',
    completedLevel + 1,
    '— eligible contributors:',
    eligible.length
  )
  // The building's state.level is no longer auto-bumped; pickNextBuildingKey
  // sets the level on the chosen building based on present players' pool
  // entry. Persistence still tracks the most recent level played.

  const next = await pickNextBuildingKey(cfg.entityName)
  await transitionToBuilding(next, cfg)
}

// Highest LEVEL the player currently has unlocked (0-indexed: 0 = first).
// Beating any building at this level or above advances availableBuildings.
function highestUnlockedLevel(profile: PlayerProfile): number {
  return Math.floor(profile.availableBuildings / BUILDING_CONFIGS.length)
}

// Each pool entry is a (building, level) pair indexed linearly by
//   index = level × N + (tier - 1)
// where N = number of buildings. So index 0 = Pisa Lv 1, 1 = Colosseum Lv 1,
// 5 = Doge's Lv 1, 6 = Pisa Lv 2, etc. A player's availableBuildings counter
// is the highest index they have access to. To advance their counter, they
// must beat a building at level >= floor(avail / N).
type PoolEntry = { entityName: string; level: number; index: number }

function decodePoolIndex(index: number): PoolEntry | null {
  const N = BUILDING_CONFIGS.length
  const tier = (index % N) + 1
  const level = Math.floor(index / N)
  const cfg = BUILDING_CONFIGS.find((c) => c.tier === tier)
  if (!cfg) return null
  return { entityName: cfg.entityName, level, index }
}

function encodePoolIndex(entityName: string, level: number): number | null {
  const cfg = BUILDING_CONFIGS.find((c) => c.entityName === entityName)
  if (!cfg) return null
  return level * BUILDING_CONFIGS.length + (cfg.tier - 1)
}

// What pool indices does this player WANT next?
//   1. The "highest available" index — their availableBuildings counter
//      itself, beating which advances them by one rung.
//   2. Each (gateBuilding, gateMax) pair where the player has currency to
//      buy a gated upgrade right now but is locked at the building's max.
function wantedIndicesFor(
  profile: PlayerProfile,
  maxAvail: number
): number[] {
  const out: number[] = []

  if (profile.availableBuildings <= maxAvail) {
    out.push(profile.availableBuildings)
  }

  const available = profile.lifetimeContributions - profile.bricksSpent
  for (const upgradeKey of Object.keys(UPGRADE_GATES)) {
    const currentLevel = (profile as Record<string, unknown>)[
      upgradeKey
    ] as number | undefined
    if (typeof currentLevel !== 'number') continue
    if (available < levelUpCost(currentLevel, upgradeKey)) continue
    const gate = gateBlockingFor(
      upgradeKey,
      currentLevel,
      profile.maxBuildingLevel
    )
    if (!gate) continue
    // Need to beat the gate building at state.level >= currentMax to bump
    // max from currentMax to currentMax+1. gate.required is currentMax+1
    // (1-indexed); the 0-indexed state.level we want is gate.required - 1.
    const targetLevel = gate.required - 1
    const idx = encodePoolIndex(gate.building, targetLevel)
    if (idx == null || idx > maxAvail) continue
    if (out.includes(idx)) continue
    out.push(idx)
  }

  return out
}

async function pickNextBuildingKey(_currentKey: string): Promise<PoolEntry> {
  type Entry = { address: string; profile: PlayerProfile }
  const players: Entry[] = []
  for (const [_, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const address = identity.address.toLowerCase()
    players.push({ address, profile: await ensureProfile(address) })
  }

  // Base pool: every (building, level) index 0..maxAvail across present
  // players. Each seeded with 1/n weight so the base sums to a unit weight.
  // We don't exclude the just-completed entry — it stays in the pool as a
  // low-priority background option (most often pulled past by another
  // player's wanted entries).
  const maxAvail = players.reduce(
    (m, p) => Math.max(m, p.profile.availableBuildings),
    0
  )
  const poolSize = maxAvail + 1
  const baseWeight = 1 / poolSize
  const weights = new Map<number, number>()
  for (let i = 0; i <= maxAvail; i++) weights.set(i, baseWeight)

  // Each player adds (1 + pity) / |pool| to each entry in their pool.
  for (const p of players) {
    const wanted = wantedIndicesFor(p.profile, maxAvail)
    if (wanted.length === 0) continue
    const contribution = (1 + p.profile.pity) / wanted.length
    for (const idx of wanted) {
      weights.set(idx, (weights.get(idx) ?? 0) + contribution)
    }
  }

  const total = [...weights.values()].reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  let chosenIdx = 0
  for (const [idx, w] of weights) {
    r -= w
    if (r <= 0) {
      chosenIdx = idx
      break
    }
  }
  const chosen =
    decodePoolIndex(chosenIdx) ?? decodePoolIndex(0)!

  // Pity update: reset for any player whose progression would advance by
  // beating this entry — either (a) the chosen index equals or exceeds their
  // chain frontier (advances availableBuildings), or (b) chosen.level >=
  // their current max for the building (advances per-building max).
  for (const p of players) {
    const advancesAvail = chosenIdx >= p.profile.availableBuildings
    const advancesMax =
      chosen.level >=
      (p.profile.maxBuildingLevel[chosen.entityName] ?? 0)
    p.profile.pity = advancesAvail || advancesMax ? 0 : p.profile.pity + 1
    void saveProfile(p.address, p.profile)
  }

  return chosen
}

async function transitionToBuilding(
  next: PoolEntry,
  completedCfg: BuildingConfig
) {
  if (!worldStateEntity) return
  const ws = WorldState.getMutable(worldStateEntity)

  // Reset the just-completed building's state (it'll fall to "hidden" client-side
  // since it's no longer the current building)
  const completedEntity = findBuildingStateEntity(completedCfg.entityName)
  if (completedEntity) {
    const s = BuildingState.getMutable(completedEntity)
    s.riseProgress = 0
    s.currentLean = 0
    s.collapsing = false
    s.collapseTime = 0
    s.collapseStartProgress = 0
    s.completedTime = 0
  }

  // Reset the new building's state, set its level to the picked entry's
  // level, and clear lazy-init flag so it re-reads its composite-loaded
  // baseGroundY on next tick.
  const nextEntity = findBuildingStateEntity(next.entityName)
  if (nextEntity) {
    const s = BuildingState.getMutable(nextEntity)
    s.level = next.level
    s.riseProgress = 0
    s.currentLean = 0
    s.collapsing = false
    s.collapseTime = 0
    s.collapseStartProgress = 0
    s.completedTime = 0
    s.baseInitialized = false
  }

  ws.brickCount = 0
  ws.currentBuildingKey = next.entityName
  currentRoundContributors.clear()

  console.log('[SERVER] Transitioning to', next.entityName, 'Lv', next.level + 1)
}

function incrementBrickCount(amount: number, straightenMultiplier = 1) {
  if (!worldStateEntity) return
  const ws = WorldState.getMutable(worldStateEntity)
  ws.brickCount += amount

  for (const [entity] of engine.getEntitiesWith(BuildingState)) {
    const cfg = configForStateEntity(entity)
    if (!cfg) continue
    const state = BuildingState.getMutable(entity)
    if (state.collapsing) continue
    if (ws.brickCount >= bricksRequiredFor(cfg, state.level)) continue
    const totalStraighten =
      brickStraightenFor(cfg, state.level) * straightenMultiplier
    state.currentLean = Math.max(0, state.currentLean - totalStraighten)
  }
}

function configForStateEntity(stateEntity: Entity): BuildingConfig | null {
  const state = BuildingState.getOrNull(stateEntity)
  if (!state) return null
  for (const cfg of BUILDING_CONFIGS) {
    if (cfg.entityName === state.buildingKey) return cfg
  }
  return null
}

function serverBuildingSystem(dt: number) {
  if (!worldStateEntity) return
  const ws = WorldState.getMutable(worldStateEntity)
  const activeKey = ws.currentBuildingKey

  for (const [entity] of engine.getEntitiesWith(BuildingState)) {
    const cfg = configForStateEntity(entity)
    if (!cfg) continue
    if (cfg.entityName !== activeKey) continue // only tick the active building

    const state = BuildingState.getMutable(entity)

    if (!state.baseInitialized) {
      const base = engine.getEntityOrNullByName(cfg.baseEntityName)
      if (!base) continue
      const bt = Transform.getOrNull(base)
      if (!bt) continue
      state.baseGroundY = bt.position.y
      state.baseInitialized = true
    }

    if (state.collapsing) {
      state.collapseTime += dt
      const tSink =
        cfg.collapseAnimDuration +
        cfg.collapseHoldDuration +
        cfg.collapseSinkDuration
      if (state.collapseTime > tSink) {
        // Hard repick: pick a fresh building and transition. Building level
        // on the failed one stays put (no progression credit, no penalty).
        // brickCount and per-building state are reset inside transitionToBuilding.
        void handleBuildingCollapse(cfg)
        // Guard against re-fire while the async transition is in flight.
        state.collapseTime = -999999
      }
      continue
    }

    const required = bricksRequiredFor(cfg, state.level)
    const target = Math.min(1, ws.brickCount / required)
    const riseEasing = 1 - Math.exp(-dt * 1.5)
    state.riseProgress += (target - state.riseProgress) * riseEasing

    const completed = ws.brickCount >= required
    if (completed) {
      const settleEasing = 1 - Math.exp(-dt * 0.8)
      state.currentLean +=
        (cfg.naturalLeanDeg - state.currentLean) * settleEasing
      state.completedTime += dt
      if (state.completedTime >= COMPLETION_CELEBRATION_S) {
        // Fire-and-forget; transitionToBuilding mutates state inside
        void handleBuildingCompletion(cfg)
        // Prevent re-firing every frame while async work proceeds
        state.completedTime = -999999
      }
    } else {
      state.completedTime = 0
      if (state.riseProgress > cfg.riseStartLeanProgress) {
        state.currentLean +=
          cfg.leanRatePerSec *
          leanRateScale(ws.effectiveLeanDampenerLevel) *
          dt
      }
    }

    const collapseThreshold =
      cfg.collapseAngleDeg + sturdyAngleBonus(ws.effectiveSturdyFoundationLevel)
    if (state.currentLean >= collapseThreshold) {
      state.collapsing = true
      state.collapseTime = 0
      state.collapseStartProgress = state.riseProgress
    }
  }
}
