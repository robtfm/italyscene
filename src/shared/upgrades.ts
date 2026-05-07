// Tunables — feel can be adjusted without rewiring.

export const MAX_LEVEL = 10
const REWARD_CAP = 1.5

// Generic level→fraction-of-max-effect curve. Saturates at L10, capped at 1.5×.
export function levelToFraction(level: number): number {
  if (level <= 0) return 0
  const f = Math.log(level + 1) / Math.log(MAX_LEVEL + 1)
  return Math.min(REWARD_CAP, f)
}

// Multi-bricks (world-wide).
export const MAX_DOUBLE_CHANCE = 0.25
export const MAX_TRIPLE_CHANCE = 0.04

export function multiBricksChances(effectiveLevel: number): {
  double: number
  triple: number
} {
  const f = levelToFraction(effectiveLevel)
  return { double: MAX_DOUBLE_CHANCE * f, triple: MAX_TRIPLE_CHANCE * f }
}

// Pickup radius (personal). Base 4m → up to 4 + 4 = 8m at L10.
export const PICKUP_RADIUS_BASE = 4
export const PICKUP_RADIUS_BONUS_MAX = 4

export function pickupRadius(personalLevel: number): number {
  return PICKUP_RADIUS_BASE + PICKUP_RADIUS_BONUS_MAX * levelToFraction(personalLevel)
}

export function harmonicSum(levels: number[]): number {
  const sorted = [...levels].sort((a, b) => b - a)
  let sum = 0
  for (let i = 0; i < sorted.length; i++) {
    sum += sorted[i] / (i + 1)
  }
  return sum
}

// Cost of advancing FROM level (level) TO level (level+1). Exponential.
export function levelUpCost(currentLevel: number): number {
  if (currentLevel >= MAX_LEVEL) return Infinity
  return Math.round(5 * Math.pow(1.5, currentLevel))
}

// Backwards-compat alias used by older callers.
export const MAX_MULTI_BRICK_LEVEL = MAX_LEVEL

export function rollBrickValue(effectiveLevel: number, rng: () => number = Math.random): number {
  const { double, triple } = multiBricksChances(effectiveLevel)
  const r = rng()
  if (r < triple) return 3
  if (r < triple + double) return 2
  return 1
}
