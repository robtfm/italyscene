// Cheap "particle" effects: short-lived primitive entities we move per-frame
// and remove when their life runs out. Bevy doesn't have a real particle
// system, so we just spawn boxes/spheres with Material + Transform and
// integrate motion manually.
import {
  engine,
  Entity,
  Material,
  MeshRenderer,
  SkyboxTime,
  Transform,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion } from '@dcl/sdk/math'
import { BuildingState } from '../shared/schemas'
import {
  BUILDING_CONFIGS,
  BuildingConfig,
  COMPLETION_CELEBRATION_S,
} from '../shared/buildings'
import { getActiveBuildingState } from './setup'

type Particle = {
  entity: Entity
  vx: number
  vy: number
  vz: number
  gravity: number
  startedAtMs: number
  lifeMs: number
  fadeStartMs: number
  scaleStart: number
  scaleEnd: number
}

const particles: Particle[] = []
const rubbleColors = [
  Color4.fromHexString('#7a6857ff'),
  Color4.fromHexString('#6b5a48ff'),
  Color4.fromHexString('#8c7a64ff'),
  Color4.fromHexString('#a3917bff'),
]
const fireworkColors = [
  Color4.fromHexString('#ffd24aff'), // gold
  Color4.fromHexString('#c8233bff'), // red
  Color4.fromHexString('#5aa0ffff'), // blue
  Color4.fromHexString('#ffffffff'), // white
  Color4.fromHexString('#82e08bff'), // green
]

function configByEntityName(name: string): BuildingConfig | undefined {
  return BUILDING_CONFIGS.find((c) => c.entityName === name)
}

export function setupEffects() {
  engine.addSystem(particleSystem)
  engine.addSystem(buildingEventEffectsSystem)
  engine.addSystem(timeOfDaySystem)
}

// SkyboxTime drives the day/night cycle. Active building's lean maps the
// time of day: lean=0 → noon, lean=collapseAngle → 6pm. On completion the
// sky cycles forward through the night to noon the next day over the 10s
// celebration window. TransitionMode 0 = TM_FORWARD, 1 = TM_BACKWARD.
const NOON = 12 * 3600
const TM_FORWARD = 0
const TM_BACKWARD = 1

// Collapse cycle runs for COLLAPSE_CYCLE_DURATION_S regardless of when the
// actual collapse animation finishes, so the sky keeps moving through the
// night even after the next building has spawned — matches the 10s feel of
// the completion cycle.
const COLLAPSE_CYCLE_DURATION_S = 10

let lastTimeOfDaySec = NOON
let prevCompleting = false
let prevCollapsing = false
let completionAnchorSec = NOON
let collapseAnchorSec = NOON
let collapseCycleTimer = 0
let collapseCycleActive = false

function cycleToNoonNextDay(anchor: number, f: number): number {
  const raw = NOON + 86400 - anchor
  const distance = raw <= 0 ? 86400 : raw
  return (anchor + Math.min(1, Math.max(0, f)) * distance) % 86400
}

function timeOfDaySystem(dt: number) {
  const active = getActiveBuildingState()
  const collapsingNow = active?.collapsing ?? false
  const completingNow =
    active != null && active.completedTime > 0 && !collapsingNow

  // Arm the collapse cycle on the false → true edge; let it run for a fixed
  // window even after the active building has been replaced.
  if (collapsingNow && !prevCollapsing) {
    collapseCycleActive = true
    collapseCycleTimer = 0
    collapseAnchorSec = lastTimeOfDaySec
  }
  if (collapseCycleActive) {
    collapseCycleTimer += dt
    if (collapseCycleTimer >= COLLAPSE_CYCLE_DURATION_S) {
      collapseCycleActive = false
    }
  }

  let target = NOON
  let mode = TM_FORWARD
  if (completingNow && active) {
    if (!prevCompleting) completionAnchorSec = lastTimeOfDaySec
    target = cycleToNoonNextDay(
      completionAnchorSec,
      active.completedTime / COMPLETION_CELEBRATION_S
    )
    mode = TM_FORWARD
  } else if (collapseCycleActive) {
    target = cycleToNoonNextDay(
      collapseAnchorSec,
      collapseCycleTimer / COLLAPSE_CYCLE_DURATION_S
    )
    mode = TM_FORWARD
  } else if (active) {
    const denom = Math.max(1, active.collapseAngleDeg)
    const ratio = Math.min(1, Math.max(0, active.displayLean / denom))
    target = NOON + ratio * 6 * 3600
    mode = target >= lastTimeOfDaySec ? TM_FORWARD : TM_BACKWARD
  }

  prevCompleting = completingNow
  prevCollapsing = collapsingNow

  SkyboxTime.createOrReplace(engine.RootEntity, {
    fixedTime: Math.floor(target),
    transitionMode: mode,
  })
  lastTimeOfDaySec = target
}

function particleSystem(dt: number) {
  const now = Date.now()
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    const age = now - p.startedAtMs
    if (age >= p.lifeMs) {
      engine.removeEntity(p.entity)
      particles.splice(i, 1)
      continue
    }
    const t = Transform.getMutableOrNull(p.entity)
    if (!t) continue
    t.position.x += p.vx * dt
    t.position.y += p.vy * dt
    t.position.z += p.vz * dt
    p.vy -= p.gravity * dt
    if (age >= p.fadeStartMs) {
      const fadeRange = Math.max(1, p.lifeMs - p.fadeStartMs)
      const f = (age - p.fadeStartMs) / fadeRange
      const s = p.scaleStart + (p.scaleEnd - p.scaleStart) * f
      t.scale.x = s
      t.scale.y = s
      t.scale.z = s
    }
  }
}

function spawnRubble(x: number, y: number, z: number, count = 28) {
  const now = Date.now()
  for (let i = 0; i < count; i++) {
    const entity = engine.addEntity()
    const sz = 0.18 + Math.random() * 0.32
    Transform.create(entity, {
      position: {
        x: x + (Math.random() - 0.5) * 4.5,
        y: y + 0.3 + Math.random() * 2,
        z: z + (Math.random() - 0.5) * 4.5,
      },
      scale: { x: sz, y: sz, z: sz },
      rotation: Quaternion.fromEulerDegrees(
        Math.random() * 360,
        Math.random() * 360,
        Math.random() * 360
      ),
    })
    MeshRenderer.setBox(entity)
    const c = rubbleColors[(Math.random() * rubbleColors.length) | 0]
    Material.setPbrMaterial(entity, {
      albedoColor: c,
      roughness: 0.95,
      metallic: 0.0,
    })
    const angle = Math.random() * Math.PI * 2
    const speed = 4 + Math.random() * 8
    const life = 2200 + Math.random() * 1400
    particles.push({
      entity,
      vx: Math.cos(angle) * speed,
      vy: 4 + Math.random() * 6,
      vz: Math.sin(angle) * speed,
      gravity: 12,
      startedAtMs: now,
      lifeMs: life,
      fadeStartMs: life * 0.6,
      scaleStart: sz,
      scaleEnd: 0,
    })
  }
}

// Uniformly random point inside a sphere of radius r centred at origin.
function randomInSphere(r: number): { x: number; y: number; z: number } {
  const u = Math.random() * 2 - 1
  const theta = Math.random() * Math.PI * 2
  const radius = r * Math.cbrt(Math.random())
  const k = Math.sqrt(1 - u * u)
  return {
    x: k * Math.cos(theta) * radius,
    y: u * radius,
    z: k * Math.sin(theta) * radius,
  }
}

function spawnFireworks(x: number, y: number, z: number, count = 60) {
  const now = Date.now()
  for (let i = 0; i < count; i++) {
    const entity = engine.addEntity()
    const sz = 0.18
    Transform.create(entity, {
      position: { x, y, z },
      scale: { x: sz, y: sz, z: sz },
    })
    MeshRenderer.setSphere(entity)
    const c = fireworkColors[(Math.random() * fireworkColors.length) | 0]
    Material.setPbrMaterial(entity, {
      albedoColor: c,
      emissiveColor: c,
      emissiveIntensity: 2.2,
      roughness: 0.3,
    })
    // Uniform point on a sphere, biased to the upper hemisphere.
    const u = Math.random() * 1.4 - 0.2
    const theta = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.max(0, 1 - u * u))
    const speed = 4 + Math.random() * 3
    const life = 1100 + Math.random() * 500
    particles.push({
      entity,
      vx: r * Math.cos(theta) * speed,
      vy: u * speed + 2,
      vz: r * Math.sin(theta) * speed,
      gravity: 4,
      startedAtMs: now,
      lifeMs: life,
      fadeStartMs: life * 0.5,
      scaleStart: sz,
      scaleEnd: 0,
    })
  }
}

// Detect collapse-start and completion transitions on building state and
// trigger the matching effect at the building's position.
type Edge = { collapsing: boolean; completing: boolean }
const prevEdge = new Map<Entity, Edge>()
// Bursts during the long completion celebration so the fireworks last more
// than a second. Map building-state-entity → next burst time (ms).
const nextCompletionBurst = new Map<Entity, number>()
const COMPLETION_BURST_INTERVAL_MS = 700

function buildingEventEffectsSystem(_dt: number) {
  const now = Date.now()
  for (const [entity, state] of engine.getEntitiesWith(BuildingState)) {
    const cfg = configByEntityName(state.buildingKey)
    const cur: Edge = {
      collapsing: state.collapsing,
      completing: state.completedTime > 0,
    }
    const prev = prevEdge.get(entity) ?? { collapsing: false, completing: false }
    if (cfg && !prev.collapsing && cur.collapsing) {
      const ps = cfg.programmaticSpawn
      if (ps) spawnRubble(ps.position.x, ps.position.y, ps.position.z)
    }
    if (cfg && !prev.completing && cur.completing) {
      const ps = cfg.programmaticSpawn
      if (ps) {
        // Centre of the celebration "burst volume": the building's top.
        const cx = ps.position.x
        const cy = ps.position.y + cfg.fullY * 0.9
        const cz = ps.position.z
        const o = randomInSphere(10)
        spawnFireworks(cx + o.x, cy + o.y, cz + o.z)
        nextCompletionBurst.set(entity, now + COMPLETION_BURST_INTERVAL_MS)
      }
    }
    // Repeat bursts while the building is still in its celebration window —
    // each burst origin sampled within a 10 m sphere around the building top.
    if (cfg && cur.completing) {
      const next = nextCompletionBurst.get(entity)
      if (next !== undefined && now >= next) {
        const ps = cfg.programmaticSpawn
        if (ps) {
          const cx = ps.position.x
          const cy = ps.position.y + cfg.fullY * 0.9
          const cz = ps.position.z
          const o = randomInSphere(10)
          spawnFireworks(cx + o.x, cy + o.y, cz + o.z, 40)
        }
        nextCompletionBurst.set(entity, now + COMPLETION_BURST_INTERVAL_MS)
      }
    } else {
      nextCompletionBurst.delete(entity)
    }
    prevEdge.set(entity, cur)
  }
  for (const entity of prevEdge.keys()) {
    if (!BuildingState.getOrNull(entity)) {
      prevEdge.delete(entity)
      nextCompletionBurst.delete(entity)
    }
  }
}
