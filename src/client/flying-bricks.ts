import {
  engine,
  Entity,
  Transform,
  MeshRenderer,
  Material,
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { WorldState } from '../shared/schemas'
import { BUILDING_CONFIGS } from '../shared/buildings'
import { room } from '../shared/messages'

// Each brick takes FLIGHT_MS ms to reach the tower; bricks within a stack
// are staggered by STAGGER_MS so a value=N pickup looks like N bricks
// streaming toward the target.
const FLIGHT_MS = 500
const STAGGER_MS = 50
const ARC_HEIGHT = 3.0 // peak vertical bump above the straight line, in metres
const TOWER_TARGET_Y_OFFSET = 0 // aim at the building's base position

type Pending = {
  start: Vector3
  target: Vector3
  spawnAt: number
  paletteValue: number
}

type Flying = {
  entity: Entity
  start: Vector3
  target: Vector3
  startedAt: number
}

const pending: Pending[] = []
const active: Flying[] = []

export function setupFlyingBricks() {
  room.onMessage('brickCollected', (data) => {
    const target = currentBuildingTarget()
    if (!target) return
    const start = Vector3.create(data.x, data.y, data.z)
    const value = Math.max(1, data.value)
    const now = Date.now()
    for (let i = 0; i < value; i++) {
      pending.push({
        start,
        target,
        spawnAt: now + i * STAGGER_MS,
        paletteValue: data.value,
      })
    }
  })
  engine.addSystem(flyingBrickSystem)
}

function currentBuildingTarget(): Vector3 | null {
  let activeKey: string | null = null
  for (const [_, ws] of engine.getEntitiesWith(WorldState)) {
    activeKey = ws.currentBuildingKey
    break
  }
  if (!activeKey) return null
  const cfg = BUILDING_CONFIGS.find((c) => c.entityName === activeKey)
  if (!cfg) return null
  const base = engine.getEntityOrNullByName(cfg.baseEntityName)
  if (!base) return null
  const t = Transform.getOrNull(base)
  if (!t) return null
  return Vector3.create(
    t.position.x,
    t.position.y + TOWER_TARGET_Y_OFFSET,
    t.position.z
  )
}

function flyingBrickSystem() {
  const now = Date.now()

  // Promote pending → active when their spawn time has come.
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i]
    if (now < p.spawnAt) continue
    pending.splice(i, 1)
    spawnFlyingBrick(p, now)
  }

  // Animate active bricks; remove when they land.
  for (let i = active.length - 1; i >= 0; i--) {
    const a = active[i]
    const t = (now - a.startedAt) / FLIGHT_MS
    if (t >= 1) {
      engine.removeEntity(a.entity)
      active.splice(i, 1)
      continue
    }
    const tr = Transform.getMutableOrNull(a.entity)
    if (!tr) continue
    tr.position.x = a.start.x + (a.target.x - a.start.x) * t
    tr.position.z = a.start.z + (a.target.z - a.start.z) * t
    // Parabolic arc on Y: 4·t·(1−t) is a unit parabola peaking at 0.5.
    tr.position.y =
      a.start.y +
      (a.target.y - a.start.y) * t +
      ARC_HEIGHT * 4 * t * (1 - t)
  }
}

function spawnFlyingBrick(p: Pending, now: number) {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: { x: p.start.x, y: p.start.y, z: p.start.z },
    scale: { x: 0.5, y: 0.35, z: 0.7 },
    rotation: {
      x: 0,
      y: Math.random() * Math.PI * 2,
      z: 0,
      w: 1,
    },
  })
  MeshRenderer.setBox(entity)
  const palette = paletteFor(p.paletteValue)
  Material.setPbrMaterial(entity, {
    albedoColor: palette.albedo,
    emissiveColor: palette.emissive,
    emissiveIntensity: palette.emissiveIntensity,
    roughness: 0.85,
    metallic: 0.0,
  })
  active.push({
    entity,
    start: p.start,
    target: p.target,
    startedAt: now,
  })
}

function paletteFor(value: number) {
  if (value >= 8)
    return {
      albedo: Color4.fromHexString('#9f4cffff'),
      emissive: Color4.fromHexString('#5a1ec0ff'),
      emissiveIntensity: 2.0,
    }
  if (value >= 4)
    return {
      albedo: Color4.fromHexString('#e6b94dff'),
      emissive: Color4.fromHexString('#b07a14ff'),
      emissiveIntensity: 1.4,
    }
  if (value >= 2)
    return {
      albedo: Color4.fromHexString('#d96a30ff'),
      emissive: Color4.fromHexString('#993315ff'),
      emissiveIntensity: 1.0,
    }
  return {
    albedo: Color4.fromHexString('#c2522dff'),
    emissive: Color4.fromHexString('#7a2a14ff'),
    emissiveIntensity: 0.6,
  }
}
