import {
  engine,
  Entity,
  InputAction,
  ColliderLayer,
  Name,
  Transform,
  pointerEventsSystem,
  raycastSystem,
} from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
import { isStateSyncronized } from '@dcl/sdk/network'
import { Brick, BuildingState, WorldState } from '../shared/schemas'
import { room } from '../shared/messages'
import {
  BUILDING_CONFIGS,
  BuildingConfig,
  bricksRequiredFor,
} from '../shared/buildings'
import { spawnPlaceholderBuildings } from '../shared/building-spawn'
import { setupFlyingBricks } from './flying-bricks'
import { brickPositions } from './brick-state'
import { setupEffects } from './effects'
import { showBuildingAdvance, showPrestigeResult } from './popup-state'
import { pickupRadius } from '../shared/upgrades'

const handledBricks = new Set<Entity>()
const localDisplayLean = new Map<Entity, number>()

export type MyStats = {
  prestigeLevel: number
  lifetimeContributions: number
  bricksSpent: number
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
  nextEffectiveMultiBricksLevel: number
  nextEffectiveFasterSpawnsLevel: number
  nextEffectiveLeanDampenerLevel: number
  nextEffectiveSturdyFoundationLevel: number
  nextEffectivePlumbTeacherLevel: number
  nextEffectiveGenerousTeacherLevel: number
  nextEffectiveStockpileLevel: number
  maxBuildingLevel: Record<string, number>
  prestigedMaxBuildingLevel: Record<string, number>
  perkPoints: Record<string, number>
}
let myStats: MyStats = {
  prestigeLevel: 0,
  lifetimeContributions: 0,
  bricksSpent: 0,
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
  nextEffectiveMultiBricksLevel: 0,
  nextEffectiveFasterSpawnsLevel: 0,
  nextEffectiveLeanDampenerLevel: 0,
  nextEffectiveSturdyFoundationLevel: 0,
  nextEffectivePlumbTeacherLevel: 0,
  nextEffectiveGenerousTeacherLevel: 0,
  nextEffectiveStockpileLevel: 0,
  maxBuildingLevel: {},
  prestigedMaxBuildingLevel: {},
  perkPoints: {},
}

function parseMaxBuildingLevel(raw: string): Record<string, number> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function getMyContribution(): number {
  return myStats.lifetimeContributions
}

export function getMyStats(): MyStats {
  return myStats
}

export function initClient() {
  console.log('[CLIENT] initClient')
  spawnPlaceholderBuildings()
  setupFlyingBricks()
  setupEffects()
  room.onMessage('buildingMaxAdvanced', (data) => {
    showBuildingAdvance(data.buildingKey, data.level)
  })
  room.onMessage('prestigeResult', (data) => {
    showPrestigeResult(data.prestigeLevel, data.advancesJson)
  })
  room.onMessage('myStatsUpdate', (data) => {
    const prevRadiusLevel = myStats.pickupRadiusLevel
    myStats = {
      prestigeLevel: data.prestigeLevel,
      lifetimeContributions: data.lifetimeContributions,
      bricksSpent: data.bricksSpent,
      multiBricksLevel: data.multiBricksLevel,
      pickupRadiusLevel: data.pickupRadiusLevel,
      fasterSpawnsLevel: data.fasterSpawnsLevel,
      leanDampenerLevel: data.leanDampenerLevel,
      sturdyFoundationLevel: data.sturdyFoundationLevel,
      plumbLineLevel: data.plumbLineLevel,
      plumbTeacherLevel: data.plumbTeacherLevel,
      generousLevel: data.generousLevel,
      generousTeacherLevel: data.generousTeacherLevel,
      stockpileLevel: data.stockpileLevel,
      titheLevel: data.titheLevel,
      nextEffectiveMultiBricksLevel: data.nextEffectiveMultiBricksLevel,
      nextEffectiveFasterSpawnsLevel: data.nextEffectiveFasterSpawnsLevel,
      nextEffectiveLeanDampenerLevel: data.nextEffectiveLeanDampenerLevel,
      nextEffectiveSturdyFoundationLevel: data.nextEffectiveSturdyFoundationLevel,
      nextEffectivePlumbTeacherLevel: data.nextEffectivePlumbTeacherLevel,
      nextEffectiveGenerousTeacherLevel: data.nextEffectiveGenerousTeacherLevel,
      nextEffectiveStockpileLevel: data.nextEffectiveStockpileLevel,
      maxBuildingLevel: parseMaxBuildingLevel(data.maxBuildingLevelJson),
      prestigedMaxBuildingLevel: parseMaxBuildingLevel(
        data.prestigedMaxBuildingLevelJson
      ),
      perkPoints: parseMaxBuildingLevel(data.perkPointsJson),
    }
    if (data.pickupRadiusLevel !== prevRadiusLevel) {
      // Re-register all brick proximity handlers with the new radius.
      for (const entity of handledBricks) {
        pointerEventsSystem.removeOnProximityEnter(entity)
      }
      handledBricks.clear()
    }
  })
  engine.addSystem(brickHandlerSystem)
  engine.addSystem(buildingVisualSystem)
  engine.addSystem(brickAnimSystem)
  engine.addSystem(earthquakeSystem)
  engine.addSystem(brickPositionSystem)
}

// Synced brick entities arrive without a Transform — server doesn't know the
// Y because it can't see physics colliders. For each new Brick we raycast
// downward at (brick.x, brick.z) and, when the result comes back, add a
// local Transform so the brick renders at the actual surface (hill, building
// roof, etc.). brickPositions tracks the resolved start position so the
// flying-brick collection visual can find the brick's y after it's removed.
const BRICK_RAYCAST_FROM_Y = 100
const BRICK_RAYCAST_MAX_DISTANCE = 200
const BRICK_HOVER_HEIGHT = 1.2
const pendingBrickRaycast = new Map<Entity, Entity>() // brick -> helper
const brickInitialized = new Set<Entity>() // bricks we've already placed
let brickRecheckCursor = 0

type BrickValue = { brickId: number; value: number; x: number; z: number }

function queueBrickRaycast(entity: Entity, brick: BrickValue) {
  if (pendingBrickRaycast.has(entity)) return
  const helper = engine.addEntity()
  Transform.create(helper, {
    position: { x: brick.x, y: BRICK_RAYCAST_FROM_Y, z: brick.z },
  })
  pendingBrickRaycast.set(entity, helper)
  const { brickId, x, z } = brick
  raycastSystem.registerGlobalDirectionRaycast(
    {
      entity: helper,
      opts: {
        direction: { x: 0, y: -1, z: 0 },
        maxDistance: BRICK_RAYCAST_MAX_DISTANCE,
        collisionMask: ColliderLayer.CL_PHYSICS,
        continuous: false,
      },
    },
    (result) => {
      const finish = () => {
        engine.removeEntity(helper)
        pendingBrickRaycast.delete(entity)
      }
      if (!Brick.getOrNull(entity)) return finish()
      const surfaceY = result.hits?.[0]?.position?.y
      if (surfaceY === undefined) return finish()
      const y = surfaceY + BRICK_HOVER_HEIGHT
      const t = Transform.getMutableOrNull(entity)
      if (t) {
        t.position.y = y
        // Keep the bob animation following the new baseline.
        const anim = brickAnim.get(entity)
        if (anim) anim.baseY = y
        brickPositions.set(brickId, { x, y, z })
      }
      finish()
    }
  )
}

function brickPositionSystem(_dt: number) {
  // Initialise new bricks: place at correct XZ + placeholder Y, queue raycast.
  for (const [entity, brick] of engine.getEntitiesWith(Brick)) {
    if (brickInitialized.has(entity)) continue
    if (pendingBrickRaycast.has(entity)) continue
    brickInitialized.add(entity)
    const visualY = Math.min(3, 0.5 * brick.value)
    Transform.createOrReplace(entity, {
      position: { x: brick.x, y: BRICK_HOVER_HEIGHT, z: brick.z },
      scale: { x: 0.8, y: visualY, z: 1.2 },
      rotation: Quaternion.fromEulerDegrees(0, Math.random() * 360, 0),
    })
    queueBrickRaycast(entity, brick)
  }

  // Re-check one initialised brick per tick (round-robin) so bricks track
  // buildings that have risen under them or fallen out from under them.
  const ready: Array<[Entity, BrickValue]> = []
  for (const [e, b] of engine.getEntitiesWith(Brick)) {
    if (brickInitialized.has(e) && !pendingBrickRaycast.has(e)) ready.push([e, b])
  }
  if (ready.length > 0) {
    const [entity, brick] = ready[brickRecheckCursor % ready.length]
    brickRecheckCursor++
    queueBrickRaycast(entity, brick)
  }

  // Clean up helpers for bricks that vanished before their raycast finished.
  for (const [entity, helper] of pendingBrickRaycast) {
    if (!Brick.getOrNull(entity)) {
      engine.removeEntity(helper)
      pendingBrickRaycast.delete(entity)
    }
  }
  for (const entity of brickInitialized) {
    if (!Brick.getOrNull(entity)) brickInitialized.delete(entity)
  }
}

// Per-hill earthquake state. While any building is collapsing, each hill
// picks a random point on a 0.1m sphere around its origin every 200ms and
// linearly tweens toward it. Once no building is collapsing, hills tween
// back to origin and idle.
type Vec3 = { x: number; y: number; z: number }
type HillJitter = {
  origin: Vec3
  from: Vec3
  target: Vec3
  startedAt: number
  atRest: boolean
}
const hillJitter = new Map<Entity, HillJitter>()
let hillCacheBuilt = false
const JITTER_RADIUS_XZ = 0.1
const JITTER_RADIUS_Y = 0.3
const JITTER_DURATION_MS = 200

function buildHillCache() {
  for (const [entity] of engine.getEntitiesWith(Transform, Name)) {
    const nm = Name.getOrNull(entity)?.value ?? ''
    if (!nm.startsWith('Hill_') && !nm.startsWith('BigHill_')) continue
    const t = Transform.get(entity)
    const origin: Vec3 = { x: t.position.x, y: t.position.y, z: t.position.z }
    hillJitter.set(entity, {
      origin,
      from: { ...origin },
      target: { ...origin },
      startedAt: 0,
      atRest: true,
    })
  }
  // Only mark as built once we've actually found hills — composite may not
  // be loaded on the first tick.
  if (hillJitter.size > 0) hillCacheBuilt = true
}

function randomOffset(): Vec3 {
  // Uniform point on a unit sphere, then scaled per-axis so vertical jitter
  // can exceed horizontal jitter.
  const u = Math.random() * 2 - 1
  const theta = Math.random() * Math.PI * 2
  const r = Math.sqrt(1 - u * u)
  return {
    x: r * Math.cos(theta) * JITTER_RADIUS_XZ,
    y: u * JITTER_RADIUS_Y,
    z: r * Math.sin(theta) * JITTER_RADIUS_XZ,
  }
}

function anyBuildingCollapsing(): boolean {
  for (const [_, state] of engine.getEntitiesWith(BuildingState)) {
    if (state.collapsing) return true
  }
  return false
}

function earthquakeSystem(_dt: number) {
  if (!hillCacheBuilt) buildHillCache()
  const collapsing = anyBuildingCollapsing()
  const now = Date.now()
  for (const [entity, jit] of hillJitter) {
    if (jit.atRest && !collapsing) continue
    const t = Transform.getMutableOrNull(entity)
    if (!t) continue
    const elapsed = now - jit.startedAt
    if (elapsed >= JITTER_DURATION_MS) {
      jit.from = { x: jit.target.x, y: jit.target.y, z: jit.target.z }
      if (collapsing) {
        const off = randomOffset()
        jit.target = {
          x: jit.origin.x + off.x,
          y: jit.origin.y + off.y,
          z: jit.origin.z + off.z,
        }
        jit.atRest = false
      } else {
        jit.target = { ...jit.origin }
        // After this leg completes, we'll land exactly on origin and idle.
      }
      jit.startedAt = now
    }
    const frac = Math.min(1, (now - jit.startedAt) / JITTER_DURATION_MS)
    t.position.x = jit.from.x + (jit.target.x - jit.from.x) * frac
    t.position.y = jit.from.y + (jit.target.y - jit.from.y) * frac
    t.position.z = jit.from.z + (jit.target.z - jit.from.z) * frac
    if (!collapsing && frac >= 1) {
      // Returned to origin — clamp exactly and stop animating.
      t.position.x = jit.origin.x
      t.position.y = jit.origin.y
      t.position.z = jit.origin.z
      jit.from = { ...jit.origin }
      jit.target = { ...jit.origin }
      jit.atRest = true
    }
  }
}

// Rotation runs server-side via Tween.setRotateContinuous (synced to clients).
// Bob stays client-only since it's pure visual flair and avoids syncing a
// position oscillation 60Hz.
const BRICK_BOB_FREQ_HZ = 0.6
const BRICK_BOB_AMP = 0.18

const brickAnim = new Map<Entity, { baseY: number; phase: number }>()

function brickAnimSystem(dt: number) {
  for (const [entity] of engine.getEntitiesWith(Brick)) {
    const t = Transform.getMutableOrNull(entity)
    if (!t) continue
    let st = brickAnim.get(entity)
    if (!st) {
      st = { baseY: t.position.y, phase: Math.random() * Math.PI * 2 }
      brickAnim.set(entity, st)
    }
    st.phase =
      (st.phase + dt * BRICK_BOB_FREQ_HZ * Math.PI * 2) % (Math.PI * 2)
    t.position.y = st.baseY + Math.sin(st.phase) * BRICK_BOB_AMP
  }
}

function brickHandlerSystem() {
  if (!isStateSyncronized()) return
  const radius = pickupRadius(myStats.pickupRadiusLevel)
  for (const [entity] of engine.getEntitiesWith(Brick)) {
    if (handledBricks.has(entity)) continue
    // Transform is added locally after the raycast resolves — registering
    // proximity-enter before that yields no useful collision shape.
    if (!Transform.getOrNull(entity)) continue
    const brick = Brick.getOrNull(entity)
    if (!brick) continue
    pointerEventsSystem.onProximityEnter(
      {
        entity,
        opts: {
          // Unity renderer requires an explicit button on the PointerEvents
          // entry even for proximity-enter events. Bevy defaults to IA_POINTER
          // when omitted, so this is for Unity compatibility.
          button: InputAction.IA_POINTER,
          maxPlayerDistance: radius,
        },
      },
      () => {
        const b = Brick.getOrNull(entity)
        if (!b) return
        room.send('collectBrick', { brickId: b.brickId })
      }
    )
    handledBricks.add(entity)
  }
}

function getCurrentBuildingKey(): string | null {
  for (const [_, ws] of engine.getEntitiesWith(WorldState)) {
    return ws.currentBuildingKey
  }
  return null
}

const COMPLETED_PERSIST_MS = 60 * 60 * 1000 // 1 hour

function buildingVisualSystem(dt: number) {
  const activeKey = getCurrentBuildingKey()
  const now = Date.now()
  for (const [entity, state] of engine.getEntitiesWith(BuildingState)) {
    const cfg = configForStateEntity(entity)
    if (!cfg) continue
    if (state.buildingKey === activeKey) {
      applyBuildingVisual(cfg, entity, dt)
    } else if (
      state.lastCompletedAt > 0 &&
      now - state.lastCompletedAt < COMPLETED_PERSIST_MS
    ) {
      // Recently completed — keep it standing at its finished state.
      applyBuildingVisual(cfg, entity, dt)
    } else {
      hideBuilding(cfg)
    }
  }
}

function hideBuilding(cfg: BuildingConfig) {
  // Push the base far below ground; the cylinder follows since it's a child
  const base = engine.getEntityOrNullByName(cfg.baseEntityName)
  if (base) {
    const bt = Transform.getMutableOrNull(base)
    if (bt) {
      bt.position.y = -50
      bt.rotation = Quaternion.fromEulerDegrees(0, 0, 0)
    }
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

function applyBuildingVisual(
  cfg: BuildingConfig,
  stateEntity: Entity,
  dt: number
) {
  const state = BuildingState.get(stateEntity)
  let leanDeg: number
  let baseSinkOffset = 0

  if (state.collapsing) {
    const tTip = cfg.collapseAnimDuration
    const tHold = tTip + cfg.collapseHoldDuration

    if (state.collapseTime < 0) {
      // Server set this to a negative guard value after firing the async
      // transition; hold the building in its fully-fallen-and-sunk pose
      // until the state reset arrives, otherwise the tipping branch
      // computes a wild rotation off the negative collapseTime.
      leanDeg = cfg.collapseAngleEnd
      baseSinkOffset = -cfg.collapseSinkDistance
    } else if (state.collapseTime <= tTip) {
      const t = state.collapseTime / cfg.collapseAnimDuration
      const eased = t * t * (3 - 2 * t)
      leanDeg =
        cfg.collapseAngleDeg +
        (cfg.collapseAngleEnd - cfg.collapseAngleDeg) * eased
    } else if (state.collapseTime <= tHold) {
      leanDeg = cfg.collapseAngleEnd
    } else {
      leanDeg = cfg.collapseAngleEnd
      const sinkT = (state.collapseTime - tHold) / cfg.collapseSinkDuration
      const eased = sinkT * sinkT
      baseSinkOffset = -cfg.collapseSinkDistance * eased
    }
    localDisplayLean.set(stateEntity, leanDeg)
  } else {
    let display = localDisplayLean.get(stateEntity) ?? 0
    if (state.riseProgress < cfg.riseStartLeanProgress) {
      // Pre-lean (fresh respawn after collapse, or just-emerged building).
      // Snap to target so we don't tween down from a stored collapseAngleEnd
      // value — that read like a violent un-tilt on tall towers.
      display = state.currentLean
    } else {
      const easing = 1 - Math.exp(-dt * 12)
      display += (state.currentLean - display) * easing
    }
    localDisplayLean.set(stateEntity, display)
    leanDeg = display
  }

  const visible = engine.getEntityOrNullByName(cfg.entityName)
  if (visible) {
    const t = Transform.getMutableOrNull(visible)
    if (t) {
      const scaleFactor =
        cfg.buriedScaleY +
        (cfg.fullScaleY - cfg.buriedScaleY) * state.riseProgress
      if (cfg.programmaticSpawn?.glbSrc) {
        // GLB: scale uniformly so the model doesn't stretch on rise.
        // Position y scales with the same factor so the model's bottom
        // stays anchored at base.y — the building grows from small to full
        // size at ground level. burialDepth (optional) sinks the model
        // further at riseProgress=0 and fades to 0 by full rise.
        const base = cfg.programmaticSpawn.glbScale ?? 1
        const burial = cfg.programmaticSpawn.burialDepth ?? 0
        t.scale.x = base * scaleFactor
        t.scale.y = base * scaleFactor
        t.scale.z = base * scaleFactor
        t.position.y =
          cfg.fullY * scaleFactor - burial * (1 - state.riseProgress)
      } else {
        // Primitive: original anim — position moves up, Y scale stretches.
        t.position.y =
          cfg.buriedY + (cfg.fullY - cfg.buriedY) * state.riseProgress
        t.scale.y = scaleFactor
      }
    }
  }

  const baseEntity = engine.getEntityOrNullByName(cfg.baseEntityName)
  if (baseEntity) {
    const bt = Transform.getMutableOrNull(baseEntity)
    if (bt) {
      bt.position.y = state.baseGroundY + baseSinkOffset
      const signed = leanDeg * cfg.leanSign
      bt.rotation =
        cfg.leanAxis === 'x'
          ? Quaternion.fromEulerDegrees(signed, 0, 0)
          : Quaternion.fromEulerDegrees(0, 0, signed)
    }
  }
}

export function getBrickCount(): number {
  for (const [_, state] of engine.getEntitiesWith(WorldState)) {
    return state.brickCount
  }
  return 0
}

export function getEffectiveMultiBricksLevel(): number {
  for (const [_, ws] of engine.getEntitiesWith(WorldState)) {
    return ws.effectiveMultiBricksLevel
  }
  return 0
}

export function getEffectiveFasterSpawnsLevel(): number {
  for (const [_, ws] of engine.getEntitiesWith(WorldState)) {
    return ws.effectiveFasterSpawnsLevel
  }
  return 0
}

export function getEffectiveLeanDampenerLevel(): number {
  for (const [_, ws] of engine.getEntitiesWith(WorldState)) {
    return ws.effectiveLeanDampenerLevel
  }
  return 0
}

export function getEffectiveSturdyFoundationLevel(): number {
  for (const [_, ws] of engine.getEntitiesWith(WorldState)) {
    return ws.effectiveSturdyFoundationLevel
  }
  return 0
}

export function getEffectivePlumbTeacherLevel(): number {
  for (const [_, ws] of engine.getEntitiesWith(WorldState)) {
    return ws.effectivePlumbTeacherLevel
  }
  return 0
}

export function getEffectiveGenerousTeacherLevel(): number {
  for (const [_, ws] of engine.getEntitiesWith(WorldState)) {
    return ws.effectiveGenerousTeacherLevel
  }
  return 0
}

export function getEffectiveStockpileLevel(): number {
  for (const [_, ws] of engine.getEntitiesWith(WorldState)) {
    return ws.effectiveStockpileLevel
  }
  return 0
}

export function getActiveBuildingState(): {
  displayName: string
  riseProgress: number
  displayLean: number
  collapseAngleDeg: number
  collapsing: boolean
  completedTime: number
  bricksRequired: number
  level: number
} | null {
  const activeKey = getCurrentBuildingKey()
  if (!activeKey) return null
  const cfg = BUILDING_CONFIGS.find((c) => c.entityName === activeKey)
  if (!cfg) return null
  for (const [entity, state] of engine.getEntitiesWith(BuildingState)) {
    if (state.buildingKey !== activeKey) continue
    return {
      displayName: cfg.displayName,
      riseProgress: state.riseProgress,
      displayLean: localDisplayLean.get(entity) ?? state.currentLean,
      collapseAngleDeg: cfg.collapseAngleDeg,
      collapsing: state.collapsing,
      completedTime: state.completedTime,
      bricksRequired: bricksRequiredFor(cfg, state.level),
      level: state.level,
    }
  }
  return null
}
