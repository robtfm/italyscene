import {
  engine,
  Entity,
  InputAction,
  Transform,
  pointerEventsSystem,
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
import { pickupRadius } from '../shared/upgrades'

const handledBricks = new Set<Entity>()
const localDisplayLean = new Map<Entity, number>()

export type MyStats = {
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
}
let myStats: MyStats = {
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
  room.onMessage('myStatsUpdate', (data) => {
    const prevRadiusLevel = myStats.pickupRadiusLevel
    myStats = {
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

    if (state.collapseTime <= tTip) {
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
    const easing = 1 - Math.exp(-dt * 12)
    display += (state.currentLean - display) * easing
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
      collapsing: state.collapsing,
      completedTime: state.completedTime,
      bricksRequired: bricksRequiredFor(cfg, state.level),
      level: state.level,
    }
  }
  return null
}
