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

export const BUILDING_CONFIGS: BuildingConfig[] = [PISA, COLOSSEUM]

// Per-building difficulty scaling. Each completion bumps the building's
// level by 1; higher levels demand more bricks and grant less straighten
// per brick — but the same upgrades still apply.
export function bricksRequiredFor(cfg: BuildingConfig, level: number): number {
  return Math.round(cfg.bricksRequired * (1 + 1.5 * Math.max(0, level)))
}
export function brickStraightenFor(cfg: BuildingConfig, level: number): number {
  return cfg.brickStraightenDeg / (1 + 0.1 * Math.max(0, level))
}
