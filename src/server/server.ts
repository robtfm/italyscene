import {
  engine,
  Entity,
  Name,
  PlayerIdentityData,
  Transform,
  MeshRenderer,
  MeshCollider,
  Material,
  ColliderLayer,
} from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { Storage } from '@dcl/sdk/server'
import { Brick, BuildingState, WorldState } from '../shared/schemas'
import { room } from '../shared/messages'
import { BUILDING_CONFIGS, BuildingConfig } from '../shared/buildings'

const SCENE_SIZE = 80
const FOUNTAIN = { x: 8, z: 8, clear: 11 }
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
  completionsByBuilding: Record<string, number>
  unlockedTier: number
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
  savedAt: number // Date.now() ms
}
const profilePromises = new Map<string, Promise<PlayerProfile>>()
const greetedEntities = new Set<Entity>()

async function loadProfile(address: string): Promise<PlayerProfile> {
  try {
    const raw = await Storage.player.get<string>(address, PROFILE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.lifetimeContributions === 'number') {
        return {
          lifetimeContributions: parsed.lifetimeContributions,
          completionsByBuilding: parsed.completionsByBuilding ?? {},
          unlockedTier: parsed.unlockedTier ?? 1,
        }
      }
    }
  } catch (e) {
    console.log('[SERVER] loadProfile error', address, e)
  }
  return { lifetimeContributions: 0, completionsByBuilding: {}, unlockedTier: 1 }
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

async function initPlayer(rawAddress: string) {
  const address = rawAddress.toLowerCase()
  const profile = await ensureProfile(address)
  room.send(
    'contributionUpdate',
    { count: profile.lifetimeContributions },
    { to: [rawAddress] }
  )
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
    handleCollectBrick(data.brickId, context.from)
  })

  room.onMessage('debugAddBrick', (_data, context) => {
    if (!context) return
    incrementBrickCount(1)
    creditPlayer(context.from, 1)
  })

  engine.addSystem(brickSpawnSystem)
  engine.addSystem(serverBuildingSystem)
  engine.addSystem(playerJoinSystem)
  engine.addSystem(worldSaveSystem)
}

function attachBuildingState(cfg: BuildingConfig) {
  const stateEntity = engine.addEntity()
  BuildingState.create(stateEntity, {
    buildingKey: cfg.entityName,
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

function brickSpawnSystem(dt: number) {
  timeSinceSpawn += dt
  if (timeSinceSpawn < BRICK_SPAWN_INTERVAL_S) return
  if (countActiveBricks() >= MAX_ACTIVE_BRICKS) {
    timeSinceSpawn = BRICK_SPAWN_INTERVAL_S
    return
  }
  timeSinceSpawn = 0
  spawnBrick()
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
    if (Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) < FOUNTAIN.clear) continue
    if (Math.hypot(x - SPAWN_AREA.x, z - SPAWN_AREA.z) < SPAWN_AREA.clear) continue
    break
  }
  const groundY = hillHeightAt(x, z)
  createBrickEntity(x, groundY + BRICK_HOVER_HEIGHT, z)
}

function createBrickEntity(x: number, y: number, z: number) {
  const entity = engine.addEntity()
  const brickId = nextBrickId++
  Brick.create(entity, { brickId, value: 1, spawnedAt: Date.now() })
  Transform.create(entity, {
    position: { x, y, z },
    scale: { x: 0.8, y: 0.5, z: 1.2 },
    rotation: { x: 0, y: Math.random() * Math.PI * 2, z: 0, w: 1 },
  })
  MeshRenderer.setBox(entity)
  MeshCollider.setBox(entity, ColliderLayer.CL_POINTER)
  Material.setPbrMaterial(entity, {
    albedoColor: Color4.fromHexString('#c2522dff'),
    roughness: 0.85,
    metallic: 0.0,
    emissiveColor: Color4.fromHexString('#7a2a14ff'),
    emissiveIntensity: 0.6,
  })
  syncEntity(entity, [
    Transform.componentId,
    Brick.componentId,
    MeshRenderer.componentId,
    Material.componentId,
    MeshCollider.componentId,
  ])
}

function handleCollectBrick(brickId: number, playerAddress: string) {
  for (const [entity, b] of engine.getEntitiesWith(Brick)) {
    if (b.brickId !== brickId) continue
    const value = b.value || 1
    incrementBrickCount(value)
    creditPlayer(playerAddress, value)
    engine.removeEntity(entity)
    return
  }
  console.log('[SERVER] collectBrick: no entity with brickId', brickId)
}

async function creditPlayer(rawAddress: string, amount: number) {
  const address = rawAddress.toLowerCase()
  currentRoundContributors.add(address)
  const profile = await ensureProfile(address)
  profile.lifetimeContributions += amount
  void saveProfile(address, profile)
  room.send(
    'contributionUpdate',
    { count: profile.lifetimeContributions },
    { to: [rawAddress] }
  )
}

function presentPlayerAddresses(): Set<string> {
  const present = new Set<string>()
  for (const [_, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    present.add(identity.address.toLowerCase())
  }
  return present
}

async function handleBuildingCompletion(cfg: BuildingConfig) {
  const present = presentPlayerAddresses()
  const eligible = [...currentRoundContributors].filter((a) => present.has(a))

  // Credit eligible players' profiles
  for (const address of eligible) {
    const profile = await ensureProfile(address)
    profile.completionsByBuilding[cfg.entityName] =
      (profile.completionsByBuilding[cfg.entityName] ?? 0) + 1
    if (cfg.tier + 1 > profile.unlockedTier) {
      profile.unlockedTier = cfg.tier + 1
    }
    void saveProfile(address, profile)
  }

  console.log(
    '[SERVER] Building completed:',
    cfg.entityName,
    '— eligible contributors:',
    eligible.length
  )

  const nextKey = await pickNextBuildingKey(cfg.entityName)
  await transitionToBuilding(nextKey, cfg)
}

async function pickNextBuildingKey(currentKey: string): Promise<string> {
  // Each in-scene player contributes 1 weight per building they have unlocked.
  // Exclude the just-completed building.
  const weights = new Map<string, number>()
  for (const [_, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const profile = await ensureProfile(identity.address.toLowerCase())
    for (const cfg of BUILDING_CONFIGS) {
      if (cfg.tier > profile.unlockedTier) continue
      if (cfg.entityName === currentKey) continue
      weights.set(cfg.entityName, (weights.get(cfg.entityName) ?? 0) + 1)
    }
  }
  if (weights.size === 0) return currentKey // only the current is unlocked → repeat
  const total = [...weights.values()].reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (const [key, w] of weights) {
    r -= w
    if (r <= 0) return key
  }
  return [...weights.keys()][0]
}

async function transitionToBuilding(nextKey: string, completedCfg: BuildingConfig) {
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

  // Reset the new building's state and lazy-init flag so it picks up its
  // composite-loaded baseGroundY on next tick.
  const nextEntity = findBuildingStateEntity(nextKey)
  if (nextEntity) {
    const s = BuildingState.getMutable(nextEntity)
    s.riseProgress = 0
    s.currentLean = 0
    s.collapsing = false
    s.collapseTime = 0
    s.collapseStartProgress = 0
    s.completedTime = 0
    s.baseInitialized = false
  }

  ws.brickCount = 0
  ws.currentBuildingKey = nextKey
  currentRoundContributors.clear()

  console.log('[SERVER] Transitioning to', nextKey)
}

function incrementBrickCount(amount: number) {
  if (!worldStateEntity) return
  const ws = WorldState.getMutable(worldStateEntity)
  ws.brickCount += amount

  for (const [entity] of engine.getEntitiesWith(BuildingState)) {
    const cfg = configForStateEntity(entity)
    if (!cfg) continue
    const state = BuildingState.getMutable(entity)
    if (state.collapsing) continue
    if (ws.brickCount >= cfg.bricksRequired) continue
    state.currentLean = Math.max(0, state.currentLean - cfg.brickStraightenDeg)
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
        ws.brickCount = Math.floor(ws.brickCount * cfg.collapseRetentionRatio)
        state.currentLean = 0
        state.riseProgress = 0
        state.collapsing = false
        state.collapseTime = 0
        state.completedTime = 0
      }
      continue
    }

    const target = Math.min(1, ws.brickCount / cfg.bricksRequired)
    const riseEasing = 1 - Math.exp(-dt * 1.5)
    state.riseProgress += (target - state.riseProgress) * riseEasing

    const completed = ws.brickCount >= cfg.bricksRequired
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
        state.currentLean += cfg.leanRatePerSec * dt
      }
    }

    if (state.currentLean >= cfg.collapseAngleDeg) {
      state.collapsing = true
      state.collapseTime = 0
      state.collapseStartProgress = state.riseProgress
    }
  }
}
