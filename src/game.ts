import {
  engine,
  Entity,
  Transform,
  MeshRenderer,
  MeshCollider,
  Material,
  InputAction,
  pointerEventsSystem,
  raycastSystem,
  RaycastQueryType,
  ColliderLayer,
  Schemas,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

export const Brick = engine.defineComponent('brick', { spawnedAt: Schemas.Number })

const SCENE_SIZE = 80
const FOUNTAIN = { x: 8, z: 8, clear: 11 }
const SPAWN_AREA = { x: 0, z: 0, clear: 9 }

const BRICK_SPAWN_INTERVAL_S = 5
const MAX_ACTIVE_BRICKS = 8
const BRICK_HOVER_HEIGHT = 1.2
const BRICK_MAX_PLAYER_DISTANCE = 4

type BuildingConfig = {
  entityName: string
  baseEntityName: string
  bricksRequired: number
  leanRatePerSec: number
  leanAxis: 'x' | 'z'
  leanSign: 1 | -1
  collapseAngleDeg: number
  brickStraightenDeg: number
  collapseRetentionRatio: number
  buriedY: number
  fullY: number
  buriedScaleY: number
  fullScaleY: number
  collapseAngleEnd: number
  collapseAnimDuration: number
  collapseHoldDuration: number
  collapseSinkDuration: number
  collapseSinkDistance: number
  riseStartLeanProgress: number
  naturalLeanDeg: number
}

const PISA: BuildingConfig = {
  entityName: 'TowerOfPisa',
  baseEntityName: 'TowerOfPisa_Base',
  bricksRequired: 30,
  leanRatePerSec: 0.6,
  leanAxis: 'x',
  leanSign: -1,
  collapseAngleDeg: 30,
  brickStraightenDeg: 4,
  collapseRetentionRatio: 0.3,
  buriedY: -0.5,
  fullY: 9,
  buriedScaleY: 3,
  fullScaleY: 18,
  collapseAngleEnd: 85,
  collapseAnimDuration: 1.5,
  collapseHoldDuration: 0.5,
  collapseSinkDuration: 1.5,
  collapseSinkDistance: 10,
  riseStartLeanProgress: 0.5,
  naturalLeanDeg: 4,
}

type BuildingState = {
  config: BuildingConfig
  riseProgress: number
  currentLean: number
  displayLean: number
  collapsing: boolean
  collapseTime: number
  collapseStartProgress: number
  baseGroundY: number
  baseInitialized: boolean
}

const buildings: BuildingState[] = [
  {
    config: PISA,
    riseProgress: 0,
    currentLean: 0,
    displayLean: 0,
    collapsing: false,
    collapseTime: 0,
    collapseStartProgress: 0,
    baseGroundY: 0,
    baseInitialized: false,
  },
]

let brickCount = 0
let timeSinceSpawn = 0

export function getBrickCount() {
  return brickCount
}

export function getPisaProgress() {
  return buildings[0].riseProgress
}

export function getPisaLean() {
  return buildings[0].displayLean
}

export function isPisaCollapsing() {
  return buildings[0].collapsing
}

export function debugAddBrick() {
  applyBrickCollect()
}

export function brickSpawnSystem(dt: number) {
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

  const probe = engine.addEntity()
  Transform.create(probe, { position: { x, y: 25, z } })
  raycastSystem.registerGlobalDirectionRaycast(
    {
      entity: probe,
      opts: {
        direction: Vector3.create(0, -1, 0),
        maxDistance: 30,
        queryType: RaycastQueryType.RQT_HIT_FIRST,
        collisionMask: ColliderLayer.CL_PHYSICS,
      },
    },
    (result) => {
      raycastSystem.removeRaycasterEntity(probe)
      const hitY =
        result.hits.length > 0 && result.hits[0].position
          ? result.hits[0].position.y
          : 0
      createBrickEntity(x, hitY + BRICK_HOVER_HEIGHT, z)
      engine.removeEntity(probe)
    }
  )
}

function createBrickEntity(x: number, y: number, z: number) {
  const entity = engine.addEntity()
  Brick.create(entity, { spawnedAt: Date.now() })
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
  pointerEventsSystem.onPointerDown(
    {
      entity,
      opts: {
        button: InputAction.IA_PRIMARY,
        hoverText: 'Raccogli mattone',
        maxPlayerDistance: BRICK_MAX_PLAYER_DISTANCE,
      },
    },
    () => {
      applyBrickCollect()
      engine.removeEntity(entity)
    }
  )
}

function applyBrickCollect() {
  brickCount += 1
  for (const b of buildings) {
    if (b.collapsing) continue
    if (brickCount >= b.config.bricksRequired) continue
    b.currentLean = Math.max(0, b.currentLean - b.config.brickStraightenDeg)
  }
}

export function buildingSystem(dt: number) {
  for (const b of buildings) {
    updateBuilding(b, dt)
  }
}

function updateBuilding(b: BuildingState, dt: number) {
  const cfg = b.config

  if (!b.baseInitialized) {
    const base = engine.getEntityOrNullByName(cfg.baseEntityName)
    if (!base) return
    const bt = Transform.getOrNull(base)
    if (!bt) return
    b.baseGroundY = bt.position.y
    b.baseInitialized = true
  }

  if (b.collapsing) {
    b.collapseTime += dt
    const tTip = cfg.collapseAnimDuration
    const tHold = tTip + cfg.collapseHoldDuration
    const tSink = tHold + cfg.collapseSinkDuration

    if (b.collapseTime <= tTip) {
      const t = b.collapseTime / cfg.collapseAnimDuration
      const eased = t * t * (3 - 2 * t)
      const angle =
        cfg.collapseAngleDeg +
        (cfg.collapseAngleEnd - cfg.collapseAngleDeg) * eased
      b.displayLean = angle
      applyBuildingTransform(b, b.riseProgress, angle)
    } else if (b.collapseTime <= tHold) {
      b.displayLean = cfg.collapseAngleEnd
      applyBuildingTransform(b, b.riseProgress, cfg.collapseAngleEnd)
    } else if (b.collapseTime <= tSink) {
      const sinkT = (b.collapseTime - tHold) / cfg.collapseSinkDuration
      const eased = sinkT * sinkT
      const sinkOffset = -cfg.collapseSinkDistance * eased
      b.displayLean = cfg.collapseAngleEnd
      applyBuildingTransform(b, b.riseProgress, cfg.collapseAngleEnd, sinkOffset)
    } else {
      brickCount = Math.floor(brickCount * cfg.collapseRetentionRatio)
      b.currentLean = 0
      b.displayLean = 0
      b.riseProgress = 0
      b.collapsing = false
      b.collapseTime = 0
      applyBuildingTransform(b, 0, 0, 0)
    }
    return
  }

  const target = Math.min(1, brickCount / cfg.bricksRequired)
  const riseEasing = 1 - Math.exp(-dt * 1.5)
  b.riseProgress += (target - b.riseProgress) * riseEasing

  const completed = brickCount >= cfg.bricksRequired
  if (completed) {
    const settleEasing = 1 - Math.exp(-dt * 0.8)
    b.currentLean += (cfg.naturalLeanDeg - b.currentLean) * settleEasing
  } else if (b.riseProgress > cfg.riseStartLeanProgress) {
    b.currentLean += cfg.leanRatePerSec * dt
  }

  const leanEasing = 1 - Math.exp(-dt * 12)
  b.displayLean += (b.currentLean - b.displayLean) * leanEasing

  if (b.displayLean >= cfg.collapseAngleDeg) {
    b.collapsing = true
    b.collapseTime = 0
    b.collapseStartProgress = b.riseProgress
  }

  applyBuildingTransform(b, b.riseProgress, b.displayLean)
}

function applyBuildingTransform(
  b: BuildingState,
  progress: number,
  leanDeg: number,
  baseSinkOffset = 0
) {
  const cfg = b.config

  const visible = engine.getEntityOrNullByName(cfg.entityName)
  if (visible) {
    const t = Transform.getMutableOrNull(visible)
    if (t) {
      t.position.y = cfg.buriedY + (cfg.fullY - cfg.buriedY) * progress
      t.scale.y = cfg.buriedScaleY + (cfg.fullScaleY - cfg.buriedScaleY) * progress
    }
  }

  const base = engine.getEntityOrNullByName(cfg.baseEntityName)
  if (base) {
    const bt = Transform.getMutableOrNull(base)
    if (bt) {
      bt.position.y = b.baseGroundY + baseSinkOffset
      const signed = leanDeg * cfg.leanSign
      bt.rotation =
        cfg.leanAxis === 'x'
          ? Quaternion.fromEulerDegrees(signed, 0, 0)
          : Quaternion.fromEulerDegrees(0, 0, signed)
    }
  }
}
