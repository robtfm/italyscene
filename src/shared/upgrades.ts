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

export function maxLevelFor(upgradeKey: string): number {
  return UPGRADE_MAX_LEVELS[upgradeKey] ?? Infinity
}

export function isAtMax(upgradeKey: string, level: number): boolean {
  return level >= maxLevelFor(upgradeKey)
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

// Plumb Line (personal). +0.5° straighten per personal level.
export function plumbLinePersonalBonus(personalLevel: number): number {
  return Math.max(0, personalLevel) * 0.5
}

// Plumb Maestro (world-wide). +0.2° straighten on every brick collected.
export function plumbLineTeacherBonus(effectiveLevel: number): number {
  return Math.max(0, effectiveLevel) * 0.2
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

// Cost of advancing FROM level (level) TO level (level+1). Exponential —
// dominates the linear effect curves so each next purchase costs ~50% more.
export function levelUpCost(currentLevel: number): number {
  return Math.round(5 * Math.pow(1.5, currentLevel))
}
