import {
  engine,
  Transform,
  MeshRenderer,
  Material,
  Name,
} from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { BUILDING_CONFIGS, BuildingConfig } from './buildings'

// Spawn placeholder cylinder visuals for any BuildingConfig with a
// programmaticSpawn block. Buildings already declared in main.composite
// (Pisa, Colosseum) skip this. Both server and client call it so each peer
// has matching named entities — Transform mutations are local; the synced
// BuildingState drives the actual building visual via buildingVisualSystem.
export function spawnPlaceholderBuildings() {
  for (const cfg of BUILDING_CONFIGS) {
    if (!cfg.programmaticSpawn) continue
    spawnOne(cfg)
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
  Transform.create(visible, {
    position: { x: 0, y: cfg.buriedY, z: 0 },
    scale: {
      x: ps.cylinderRadius * 2,
      y: cfg.buriedScaleY,
      z: ps.cylinderRadius * 2,
    },
    parent: base,
  })
  MeshRenderer.setCylinder(visible)
  Material.setPbrMaterial(visible, {
    albedoColor: Color4.create(ps.color.r, ps.color.g, ps.color.b, 1),
    roughness: 0.85,
    metallic: 0.0,
  })
}
