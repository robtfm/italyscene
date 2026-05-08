// Tunables — feel can be adjusted without rewiring.
//
// All upgrades scale linearly (or asymptotically where 0/100% bounds matter)
// and have no max level — costs stay exponential so growth tapers naturally.
// Pickup Radius is the one exception: a hard cap keeps clicking distance from
// trivialising the game.

export const PICKUP_RADIUS_MAX_LEVEL = 10

const UPGRADE_MAX_LEVELS: Record<string, number> = {
  pickupRadiusLevel: PICKUP_RADIUS_MAX_LEVEL,
}

// Each gated upgrade requires the player to have personally beaten the
// listed building at level >= upgrade level. Multi-bricks is the only
// always-available upgrade.
export const UPGRADE_GATES: Record<string, string> = {
  // Pisa
  plumbTeacherLevel: 'TowerOfPisa',
  // Colosseum
  stockpileLevel: 'Colosseum',
  // Duomo
  generousTeacherLevel: 'Duomo',
  generousLevel: 'Duomo',
  // Pantheon
  sturdyFoundationLevel: 'Pantheon',
  plumbLineLevel: 'Pantheon',
  // Trevi
  fasterSpawnsLevel: 'Trevi',
  pickupRadiusLevel: 'Trevi',
  // Doge's Palace
  leanDampenerLevel: 'DogesPalace',
  titheLevel: 'DogesPalace',
}

export function maxLevelFor(upgradeKey: string): number {
  return UPGRADE_MAX_LEVELS[upgradeKey] ?? Infinity
}

// Effective max purchasable level for an upgrade given the player's
// per-building max levels. min(hard cap, building gate's max).
export function effectiveMaxLevel(
  upgradeKey: string,
  maxBuildingLevels: Record<string, number>
): number {
  const hardCap = maxLevelFor(upgradeKey)
  const gateBuilding = UPGRADE_GATES[upgradeKey]
  if (!gateBuilding) return hardCap
  const gateMax = maxBuildingLevels[gateBuilding] ?? 0
  return Math.min(hardCap, gateMax)
}

export function isAtMax(upgradeKey: string, level: number): boolean {
  return level >= maxLevelFor(upgradeKey)
}

export function isAtEffectiveMax(
  upgradeKey: string,
  level: number,
  maxBuildingLevels: Record<string, number>
): boolean {
  return level >= effectiveMaxLevel(upgradeKey, maxBuildingLevels)
}

// Returns gate info if this upgrade is currently blocked by a building's
// max level (and NOT by its hard cap). null otherwise.
export function gateBlockingFor(
  upgradeKey: string,
  level: number,
  maxBuildingLevels: Record<string, number>
): { building: string; required: number } | null {
  if (level >= maxLevelFor(upgradeKey)) return null // hard cap, not gate
  const gateBuilding = UPGRADE_GATES[upgradeKey]
  if (!gateBuilding) return null
  const gateMax = maxBuildingLevels[gateBuilding] ?? 0
  if (level < gateMax) return null // not gated yet
  return { building: gateBuilding, required: level + 1 }
}

// Brick Bonus (world-wide). Each spawn's stack size is in [1, floor(L)+1],
// drawn via rng^p so smaller stacks are more common than huge ones.
// Power 2 ≈ "a bit" skewed: at L=20, value=1 lands ~22% of the time
// instead of the linear ~5%, while value=21 still appears ~2%.
export const BRICK_VALUE_RNG_POWER = 2

export function maxBrickStack(effectiveLevel: number): number {
  if (effectiveLevel <= 0) return 1
  // Largest value rollBrickValue can return: 1 + floor(span - eps).
  const span = effectiveLevel + 1
  return Number.isInteger(span) ? span : 1 + Math.floor(span)
}

export function rollBrickValue(
  effectiveLevel: number,
  rng: () => number = Math.random
): number {
  const span = Math.max(1, effectiveLevel + 1)
  return 1 + Math.floor(Math.pow(rng(), BRICK_VALUE_RNG_POWER) * span)
}

// Builder's Reach (personal). 1m + level, hard-capped at level 10 (radius 11m).
export const PICKUP_RADIUS_BASE = 1
export function pickupRadius(personalLevel: number): number {
  return PICKUP_RADIUS_BASE + Math.min(personalLevel, PICKUP_RADIUS_MAX_LEVEL)
}

// Supply Lines (world-wide). Asymptotic: interval × 1/(1 + 0.15*L). L=10 →
// 0.40×, L=50 → 0.12×, never reaches 0.
export function spawnIntervalScale(effectiveLevel: number): number {
  return 1 / (1 + 0.15 * Math.max(0, effectiveLevel))
}

// Scaffolding (world-wide). Asymptotic lean-rate scaler with the same shape.
export function leanRateScale(effectiveLevel: number): number {
  return 1 / (1 + 0.15 * Math.max(0, effectiveLevel))
}

// Opus Romano (world-wide). +1° collapse threshold per effective level.
export function sturdyAngleBonus(effectiveLevel: number): number {
  return Math.max(0, effectiveLevel)
}

// Plumb Line (personal). Multiplicative on the building's per-brick
// straighten — +10% per personal level. Stays coupled to building design;
// can't outrun the per-building level scaling.
export function plumbLinePersonalBonus(personalLevel: number): number {
  return Math.max(0, personalLevel) * 0.1
}

// Plumb Maestro (world-wide). Multiplicative bonus on every brick collected
// — +4% per effective level. Smaller than the personal version since it
// applies to all players.
export function plumbLineTeacherBonus(effectiveLevel: number): number {
  return Math.max(0, effectiveLevel) * 0.04
}

// Artful Contribution (personal). +5% building progress per personal level.
export function contributionPersonalBonus(personalLevel: number): number {
  return Math.max(0, personalLevel) * 0.05
}

// Artful Maestro (world-wide). +2% per effective level on every brick.
export function contributionTeacherBonus(effectiveLevel: number): number {
  return Math.max(0, effectiveLevel) * 0.02
}

// Stockpile (world-wide). cap × (1 + 0.2*L). L=10 → 3×, L=50 → 11×.
export function brickCapMultiplier(effectiveLevel: number): number {
  return 1 + 0.2 * Math.max(0, effectiveLevel)
}

// Padrone's Cut (personal). +5% upgrade currency per personal level.
export function titheBonus(personalLevel: number): number {
  return Math.max(0, personalLevel) * 0.05
}

// Stack contributions sorted high→low. Position 0 keeps full weight (solo
// baseline unchanged); subsequent positions decay as 5/(i+5), gentler than
// the classic 1/(i+1) so subsequent players still feel meaningful.
//   i=0 → 1.00, i=1 → 0.83, i=2 → 0.71, i=3 → 0.63, i=4 → 0.56 ...
export function harmonicSum(levels: number[]): number {
  const sorted = [...levels].sort((a, b) => b - a)
  let sum = 0
  for (let i = 0; i < sorted.length; i++) {
    sum += (sorted[i] * 5) / (i + 5)
  }
  return sum
}

// Per-upgrade cost multiplier — Tithe & Multi-bricks (force multipliers on
// the brick economy itself) cost more; quality-of-life upgrades cost less.
// Average is ~1.0× across the 11 upgrades.
const UPGRADE_COST_MULTIPLIERS: Record<string, number> = {
  titheLevel: 2.0, // pure currency multiplier
  multiBricksLevel: 1.5, // boosts both progress + currency per stack
  fasterSpawnsLevel: 1.2, // late-game enabler
  plumbTeacherLevel: 1.0,
  leanDampenerLevel: 0.9,
  generousTeacherLevel: 0.8,
  plumbLineLevel: 0.8,
  stockpileLevel: 0.7,
  sturdyFoundationLevel: 0.7,
  generousLevel: 0.7,
  pickupRadiusLevel: 0.6, // pure quality-of-life
}

const UPGRADE_COST_BASE = 100
const UPGRADE_COST_GROWTH = 3.0

// Cost of advancing FROM level (level) TO level (level+1). Exponential —
// outpaces the linear bricks-per-building-level curve so late upgrades stay
// expensive even after multi-bricks blooms the brick economy.
export function levelUpCost(currentLevel: number, upgradeKey = ''): number {
  const mult = UPGRADE_COST_MULTIPLIERS[upgradeKey] ?? 1.0
  return Math.round(
    UPGRADE_COST_BASE * mult * Math.pow(UPGRADE_COST_GROWTH, currentLevel)
  )
}
