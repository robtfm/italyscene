import {
  engine,
  Entity,
  Transform,
  pointerEventsSystem,
  InputAction,
} from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
import { isStateSyncronized } from '@dcl/sdk/network'
import { Brick, BuildingState, WorldState } from '../shared/schemas'
import { room } from '../shared/messages'
import { BUILDING_CONFIGS, BuildingConfig } from '../shared/buildings'

const BRICK_MAX_PLAYER_DISTANCE = 4

const handledBricks = new Set<Entity>()
const localDisplayLean = new Map<Entity, number>()
let myContribution = 0

export function getMyContribution(): number {
  return myContribution
}

export function initClient() {
  console.log('[CLIENT] initClient')
  room.onMessage('contributionUpdate', (data) => {
    myContribution = data.count
  })
  engine.addSystem(brickHandlerSystem)
  engine.addSystem(buildingVisualSystem)
}

function brickHandlerSystem() {
  if (!isStateSyncronized()) return
  for (const [entity] of engine.getEntitiesWith(Brick)) {
    if (handledBricks.has(entity)) continue
    pointerEventsSystem.onPointerDown(
      {
        entity,
        opts: {
          button: InputAction.IA_PRIMARY,
          hoverText: 'Collect brick',
          maxPlayerDistance: BRICK_MAX_PLAYER_DISTANCE,
        },
      },
      () => {
        const brick = Brick.getOrNull(entity)
        if (!brick) return
        room.send('collectBrick', { brickId: brick.brickId })
      }
    )
    handledBricks.add(entity)
  }
}

function buildingVisualSystem(dt: number) {
  for (const [entity] of engine.getEntitiesWith(BuildingState)) {
    const cfg = configForStateEntity(entity)
    if (!cfg) continue
    applyBuildingVisual(cfg, entity, dt)
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
      t.position.y =
        cfg.buriedY + (cfg.fullY - cfg.buriedY) * state.riseProgress
      t.scale.y =
        cfg.buriedScaleY +
        (cfg.fullScaleY - cfg.buriedScaleY) * state.riseProgress
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

export function getPisaState(): {
  riseProgress: number
  displayLean: number
  collapsing: boolean
} {
  for (const [entity, state] of engine.getEntitiesWith(BuildingState)) {
    if (state.buildingKey !== 'TowerOfPisa') continue
    return {
      riseProgress: state.riseProgress,
      displayLean: localDisplayLean.get(entity) ?? state.currentLean,
      collapsing: state.collapsing,
    }
  }
  return { riseProgress: 0, displayLean: 0, collapsing: false }
}
