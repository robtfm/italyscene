export type BuildingConfig = {
  entityName: string
  baseEntityName: string
  displayName: string
  tier: number
  bricksRequired: number
  leanRatePerSec: number
  leanAxis: 'x' | 'z'
  leanSign: 1 | -1
  collapseAngleDeg: number
  brickStraightenDeg: number
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
  // Programmatic-spawn parameters. Both server and client create the visual
  // at scene init (any composite-loaded entity with the same name is removed
  // first so the GLB/primitive can take its place cleanly).
  //   glbSrc → load a GLB; the building scales uniformly on rise.
  //   otherwise → cylinder/box primitive; only Y stretches on rise.
  programmaticSpawn?: {
    position: { x: number; y: number; z: number }
    yawDeg?: number // rotation around Y axis (degrees), applied on the visible
    pitchDeg?: number // rotation around X axis (compensates baked-in tilts)
    glbSrc: string
    glbScale?: number // uniform multiplier (default 1)
    // Extra sink (in metres) applied at riseProgress=0 only, fading linearly
    // to 0 by riseProgress=1. Use to hide the buried base detail of models
    // that should "emerge" from the ground rather than start above it.
    burialDepth?: number
  }
}

export const PISA: BuildingConfig = {
  entityName: 'TowerOfPisa',
  baseEntityName: 'TowerOfPisa_Base',
  displayName: 'Tower of Pisa',
  tier: 1,
  bricksRequired: 30,
  leanRatePerSec: 0.4,
  leanAxis: 'x',
  leanSign: -1,
  collapseAngleDeg: 30,
  brickStraightenDeg: 4,
  buriedY: -16.5,
  fullY: 12.5, // -1m sink, scaled with 1.5×
  buriedScaleY: 0.2,
  fullScaleY: 1.0,
  collapseAngleEnd: 85,
  collapseAnimDuration: 1.5,
  collapseHoldDuration: 0.5,
  collapseSinkDuration: 1.5,
  collapseSinkDistance: 10,
  riseStartLeanProgress: 0.5,
  naturalLeanDeg: 4,
  programmaticSpawn: {
    position: { x: 40, y: 3, z: 40 },
    glbSrc: 'assets/Models/buildings/pisa.glb',
    glbScale: 27, // 1.5× of prior 18
    burialDepth: 6,
    pitchDeg: 10, // model has baked-in lean; counter-rotate around +X

  },
}

export const COLOSSEUM: BuildingConfig = {
  entityName: 'Colosseum',
  baseEntityName: 'Colosseum_Base',
  displayName: 'Colosseum',
  tier: 2,
  bricksRequired: 60,
  leanRatePerSec: 0.5,
  leanAxis: 'z',
  leanSign: 1,
  collapseAngleDeg: 25,
  brickStraightenDeg: 4.2,
  buriedY: -4.3,
  fullY: 0.86,
  buriedScaleY: 0.2,
  fullScaleY: 1.0,
  collapseAngleEnd: 70,
  collapseAnimDuration: 1.8,
  collapseHoldDuration: 0.5,
  collapseSinkDuration: 1.5,
  collapseSinkDistance: 9,
  riseStartLeanProgress: 0.5,
  naturalLeanDeg: 0,
  programmaticSpawn: {
    position: { x: 40, y: 3, z: 15 },
    yawDeg: 0,
    glbSrc: 'assets/Models/buildings/colosseum.glb',
    glbScale: 6, // native ~4m wide (internal 100× scale); target ~24m
    burialDepth: 1.5,

  },
}

export const DUOMO: BuildingConfig = {
  entityName: 'Duomo',
  baseEntityName: 'Duomo_Base',
  displayName: 'Duomo di Firenze',
  tier: 3,
  bricksRequired: 90,
  leanRatePerSec: 0.45,
  leanAxis: 'x',
  leanSign: 1,
  collapseAngleDeg: 22,
  brickStraightenDeg: 3.0,
  buriedY: -21,
  fullY: 0.55,
  buriedScaleY: 0.2,
  fullScaleY: 1.0,
  collapseAngleEnd: 65,
  collapseAnimDuration: 1.6,
  collapseHoldDuration: 0.5,
  collapseSinkDuration: 1.5,
  collapseSinkDistance: 11,
  riseStartLeanProgress: 0.5,
  naturalLeanDeg: 1,
  programmaticSpawn: {
    position: { x: 62, y: 3.5, z: 43 },
    yawDeg: 0, // 9 o'clock rotation baked into the GLB root node
    glbSrc: 'assets/Models/buildings/duomo.glb',
    glbScale: 0.004, // 80% of prior 0.005; ~15m tall
    burialDepth: 3,

  },
}

export const PANTHEON: BuildingConfig = {
  entityName: 'Pantheon',
  baseEntityName: 'Pantheon_Base',
  displayName: 'Pantheon',
  tier: 4,
  bricksRequired: 120,
  leanRatePerSec: 0.3,
  leanAxis: 'z',
  leanSign: -1,
  collapseAngleDeg: 20,
  brickStraightenDeg: 1.8,
  buriedY: -7.2,
  fullY: 0.1,
  buriedScaleY: 0.2,
  fullScaleY: 1.0,
  collapseAngleEnd: 60,
  collapseAnimDuration: 1.8,
  collapseHoldDuration: 0.5,
  collapseSinkDuration: 1.5,
  collapseSinkDistance: 10,
  riseStartLeanProgress: 0.5,
  naturalLeanDeg: 0,
  programmaticSpawn: {
    position: { x: 17, y: 3, z: 52 },
    yawDeg: 120, // faces 4 o'clock
    glbSrc: 'assets/Models/buildings/pantheon.glb',
    glbScale: 0.0048, // dome-node scale (1500/500) baked in; native span ~1650; target ~8m
    burialDepth: 1,

  },
}

export const TREVI: BuildingConfig = {
  entityName: 'Trevi',
  baseEntityName: 'Trevi_Base',
  displayName: 'Trevi Fountain',
  tier: 5,
  bricksRequired: 150,
  leanRatePerSec: 0.6,
  leanAxis: 'x',
  leanSign: -1,
  collapseAngleDeg: 18,
  brickStraightenDeg: 3.0,
  buriedY: -6.5,
  fullY: 1.94,
  buriedScaleY: 0.2,
  fullScaleY: 1.0,
  collapseAngleEnd: 55,
  collapseAnimDuration: 1.5,
  collapseHoldDuration: 0.5,
  collapseSinkDuration: 1.5,
  collapseSinkDistance: 13,
  riseStartLeanProgress: 0.5,
  naturalLeanDeg: 2,
  programmaticSpawn: {
    position: { x: 50, y: 3.5, z: 60 },
    glbSrc: 'assets/Models/buildings/trevi.glb',
    glbScale: 10, // native ~2m; target ~20m

  },
}

export const DOGES_PALACE: BuildingConfig = {
  entityName: 'DogesPalace',
  baseEntityName: 'DogesPalace_Base',
  displayName: "Doge's Palace",
  tier: 6,
  bricksRequired: 180,
  leanRatePerSec: 0.45,
  leanAxis: 'z',
  leanSign: 1,
  collapseAngleDeg: 16,
  brickStraightenDeg: 2.0,
  buriedY: -19.8,
  fullY: -1,
  buriedScaleY: 0.2,
  fullScaleY: 1.0,
  collapseAngleEnd: 50,
  collapseAnimDuration: 2.0,
  collapseHoldDuration: 0.5,
  collapseSinkDuration: 1.5,
  collapseSinkDistance: 9,
  riseStartLeanProgress: 0.5,
  naturalLeanDeg: 0,
  programmaticSpawn: {
    position: { x: 15, y: 3, z: 25 },
    yawDeg: 60, // faces 2 o'clock
    glbSrc: 'assets/Models/buildings/doges.glb',
    glbScale: 1.5,
    burialDepth: 3,
  },
}

export const BUILDING_CONFIGS: BuildingConfig[] = [
  PISA,
  COLOSSEUM,
  DUOMO,
  PANTHEON,
  TREVI,
  DOGES_PALACE,
]

// Per-building difficulty scaling. Each completion bumps the building's
// level by 1; higher levels demand more bricks and grant less straighten
// per brick — but the same upgrades still apply.
export function bricksRequiredFor(cfg: BuildingConfig, level: number): number {
  return Math.round(cfg.bricksRequired * (1 + 1.5 * Math.max(0, level)))
}
export function brickStraightenFor(cfg: BuildingConfig, level: number): number {
  return cfg.brickStraightenDeg / (1 + (1 / 3) * Math.max(0, level))
}
