export type BuildingConfig = {
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

export const PISA: BuildingConfig = {
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

export const BUILDING_CONFIGS: BuildingConfig[] = [PISA]
