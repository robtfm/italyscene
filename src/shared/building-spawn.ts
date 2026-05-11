import {
  engine,
  Transform,
  GltfContainer,
  Name,
  TextShape,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion } from '@dcl/sdk/math'
import { BUILDING_CONFIGS, BuildingConfig } from './buildings'

// Both server and client call this at init. Each building with a
// programmaticSpawn block gets its base + visible entities created here.
export function spawnPlaceholderBuildings() {
  for (const cfg of BUILDING_CONFIGS) {
    if (!cfg.programmaticSpawn) continue
    spawnOne(cfg)
    spawnPreviewCopy(cfg)
  }
}

function spawnOne(cfg: BuildingConfig) {
  const ps = cfg.programmaticSpawn!
  const base = engine.addEntity()
  Name.create(base, { value: cfg.baseEntityName })
  Transform.create(base, {
    position: { x: ps.position.x, y: ps.position.y, z: ps.position.z },
  })

  const visible = engine.addEntity()
  Name.create(visible, { value: cfg.entityName })
  const s = ps.glbScale ?? 1
  Transform.create(visible, {
    position: { x: 0, y: cfg.buriedY, z: 0 },
    scale: { x: s, y: s * cfg.buriedScaleY, z: s },
    rotation: Quaternion.fromEulerDegrees(
      ps.pitchDeg ?? 0,
      ps.yawDeg ?? 0,
      0
    ),
    parent: base,
  })
  GltfContainer.create(visible, { src: ps.glbSrc })
}

// Debug-only: a static, fully-grown copy of each building at its actual
// "completed" position (where the real one will rise to). Lets us eyeball
// all six at once. The active building's animated copy will visually
// overlap with its preview when that building is being played.
function spawnPreviewCopy(cfg: BuildingConfig) {
  const ps = cfg.programmaticSpawn
  if (!ps) return
  const fullScale = (ps.glbScale ?? 1) * cfg.fullScaleY

  const preview = engine.addEntity()
  Transform.create(preview, {
    position: {
      x: ps.position.x,
      y: ps.position.y + cfg.fullY,
      z: ps.position.z,
    },
    scale: { x: fullScale, y: fullScale, z: fullScale },
    rotation: Quaternion.fromEulerDegrees(
      ps.pitchDeg ?? 0,
      ps.yawDeg ?? 0,
      0
    ),
  })
  GltfContainer.create(preview, { src: ps.glbSrc })

  // Floating name label above the building (uses a generous fixed offset
  // that clears the tallest model with margin).
  const label = engine.addEntity()
  Transform.create(label, {
    position: {
      x: ps.position.x,
      y: ps.position.y + 25,
      z: ps.position.z,
    },
  })
  TextShape.create(label, {
    text: cfg.displayName,
    fontSize: 8,
    textColor: Color4.create(1, 1, 1, 1),
    outlineColor: Color4.create(0, 0, 0, 1),
    outlineWidth: 0.15,
  })
}
