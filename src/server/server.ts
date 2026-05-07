import {
  engine,
  Entity,
  Name,
  Transform,
  MeshRenderer,
  MeshCollider,
  Material,
  ColliderLayer,
} from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
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
const contributions = new Map<string, number>()

export function initServer() {
  console.log('[SERVER] initServer')

  worldStateEntity = engine.addEntity()
  WorldState.create(worldStateEntity, { brickCount: 0 })
  syncEntity(worldStateEntity, [WorldState.componentId])

  for (const cfg of BUILDING_CONFIGS) {
    attachBuildingState(cfg)
  }

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
  })
  syncEntity(stateEntity, [BuildingState.componentId])
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

function creditPlayer(rawAddress: string, amount: number) {
  const address = rawAddress.toLowerCase()
  const next = (contributions.get(address) ?? 0) + amount
  contributions.set(address, next)
  room.send('contributionUpdate', { count: next }, { to: [rawAddress] })
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

  for (const [entity] of engine.getEntitiesWith(BuildingState)) {
    const cfg = configForStateEntity(entity)
    if (!cfg) continue
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
    } else if (state.riseProgress > cfg.riseStartLeanProgress) {
      state.currentLean += cfg.leanRatePerSec * dt
    }

    if (state.currentLean >= cfg.collapseAngleDeg) {
      state.collapsing = true
      state.collapseTime = 0
      state.collapseStartProgress = state.riseProgress
    }
  }
}
