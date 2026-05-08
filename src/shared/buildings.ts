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
  // Optional programmatic-spawn parameters. Set for buildings NOT in
  // main.composite — both server and client will create the cylinder
  // primitive at scene init.
  programmaticSpawn?: {
    position: { x: number; y: number; z: number }
    cylinderRadius: number
    color: { r: number; g: number; b: number }
  }
}

export const PISA: BuildingConfig = {
  entityName: 'TowerOfPisa',
  baseEntityName: 'TowerOfPisa_Base',
  displayName: 'Tower of Pisa',
  tier: 1,
  bricksRequired: 30,
  leanRatePerSec: 0.6,
  leanAxis: 'x',
  leanSign: -1,
  collapseAngleDeg: 30,
  brickStraightenDeg: 4,
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

export const COLOSSEUM: BuildingConfig = {
  entityName: 'Colosseum',
  baseEntityName: 'Colosseum_Base',
  displayName: 'Colosseum',
  tier: 2,
  bricksRequired: 60,
  leanRatePerSec: 0.4,
  leanAxis: 'z',
  leanSign: 1,
  collapseAngleDeg: 25,
  brickStraightenDeg: 3,
  buriedY: -0.5,
  fullY: 4,
  buriedScaleY: 2,
  fullScaleY: 8,
  collapseAngleEnd: 70,
  collapseAnimDuration: 1.8,
  collapseHoldDuration: 0.5,
  collapseSinkDuration: 1.5,
  collapseSinkDistance: 9,
  riseStartLeanProgress: 0.5,
  naturalLeanDeg: 0,
}

export const DUOMO: BuildingConfig = {
  entityName: 'Duomo',
  baseEntityName: 'Duomo_Base',
  displayName: 'Duomo di Firenze',
  tier: 3,
  bricksRequired: 90,
  leanRatePerSec: 0.35,
  leanAxis: 'x',
  leanSign: 1,
  collapseAngleDeg: 22,
  brickStraightenDeg: 2.5,
  buriedY: -0.5,
  fullY: 5,
  buriedScaleY: 2.5,
  fullScaleY: 12,
  collapseAngleEnd: 65,
  collapseAnimDuration: 1.6,
  collapseHoldDuration: 0.5,
  collapseSinkDuration: 1.5,
  collapseSinkDistance: 11,
  riseStartLeanProgress: 0.5,
  naturalLeanDeg: 1,
  programmaticSpawn: {
    position: { x: 55, y: 3.5, z: 35 },
    cylinderRadius: 4,
    color: { r: 0.85, g: 0.55, b: 0.4 }, // terracotta
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
  brickStraightenDeg: 2.2,
  buriedY: -0.5,
  fullY: 4,
  buriedScaleY: 2,
  fullScaleY: 9,
  collapseAngleEnd: 60,
  collapseAnimDuration: 1.8,
  collapseHoldDuration: 0.5,
  collapseSinkDuration: 1.5,
  collapseSinkDistance: 10,
  riseStartLeanProgress: 0.5,
  naturalLeanDeg: 0,
  programmaticSpawn: {
    position: { x: 15, y: 3, z: 50 },
    cylinderRadius: 5,
    color: { r: 0.92, g: 0.86, b: 0.7 }, // travertine beige
  },
}

export const TREVI: BuildingConfig = {
  entityName: 'Trevi',
  baseEntityName: 'Trevi_Base',
  displayName: 'Trevi Fountain',
  tier: 5,
  bricksRequired: 150,
  leanRatePerSec: 0.4,
  leanAxis: 'x',
  leanSign: -1,
  collapseAngleDeg: 18,
  brickStraightenDeg: 2,
  buriedY: -0.5,
  fullY: 6,
  buriedScaleY: 2.5,
  fullScaleY: 13,
  collapseAngleEnd: 55,
  collapseAnimDuration: 1.5,
  collapseHoldDuration: 0.5,
  collapseSinkDuration: 1.5,
  collapseSinkDistance: 13,
  riseStartLeanProgress: 0.5,
  naturalLeanDeg: 2,
  programmaticSpawn: {
    position: { x: 50, y: 3.5, z: 70 },
    cylinderRadius: 3.5,
    color: { r: 0.96, g: 0.95, b: 0.92 }, // white marble
  },
}

export const DOGES_PALACE: BuildingConfig = {
  entityName: 'DogesPalace',
  baseEntityName: 'DogesPalace_Base',
  displayName: "Doge's Palace",
  tier: 6,
  bricksRequired: 180,
  leanRatePerSec: 0.25,
  leanAxis: 'z',
  leanSign: 1,
  collapseAngleDeg: 16,
  brickStraightenDeg: 1.8,
  buriedY: -0.5,
  fullY: 3.5,
  buriedScaleY: 1.5,
  fullScaleY: 7,
  collapseAngleEnd: 50,
  collapseAnimDuration: 2.0,
  collapseHoldDuration: 0.5,
  collapseSinkDuration: 1.5,
  collapseSinkDistance: 9,
  riseStartLeanProgress: 0.5,
  naturalLeanDeg: 0,
  programmaticSpawn: {
    position: { x: 15, y: 3, z: 25 },
    cylinderRadius: 6,
    color: { r: 0.95, g: 0.78, b: 0.78 }, // Venetian pink
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
  return cfg.brickStraightenDeg / (1 + 0.1 * Math.max(0, level))
}
