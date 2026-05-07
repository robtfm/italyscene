// Tunables — feel can be adjusted without rewiring.

export const MAX_MULTI_BRICK_LEVEL = 10

// At max effective level (+harmonic stacking), these are the asymptotic chances.
export const MAX_DOUBLE_CHANCE = 0.25
export const MAX_TRIPLE_CHANCE = 0.04

// reward(L) = max_effect * ln(L+1) / ln(max+1)
// Cap the multiplier at 1.5 to prevent crazy stacking from many high-tier players.
const REWARD_CAP = 1.5

export function multiBricksRewardFraction(effectiveLevel: number): number {
  if (effectiveLevel <= 0) return 0
  const f = Math.log(effectiveLevel + 1) / Math.log(MAX_MULTI_BRICK_LEVEL + 1)
  return Math.min(REWARD_CAP, f)
}

export function multiBricksChances(effectiveLevel: number): {
  double: number
  triple: number
} {
  const f = multiBricksRewardFraction(effectiveLevel)
  return { double: MAX_DOUBLE_CHANCE * f, triple: MAX_TRIPLE_CHANCE * f }
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
  if (currentLevel >= MAX_MULTI_BRICK_LEVEL) return Infinity
  return Math.round(5 * Math.pow(1.5, currentLevel))
}

export function rollBrickValue(effectiveLevel: number, rng: () => number = Math.random): number {
  const { double, triple } = multiBricksChances(effectiveLevel)
  const r = rng()
  if (r < triple) return 3
  if (r < triple + double) return 2
  return 1
}
