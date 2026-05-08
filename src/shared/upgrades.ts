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

// Faster spawns (world-wide). Multiplies the spawn interval by 1/(1 + bonus).
// At L10 effective: interval is halved (~2.5s vs 5s base).
export function spawnIntervalScale(effectiveLevel: number): number {
  return 1 / (1 + 1.0 * levelToFraction(effectiveLevel))
}

// Lean dampener (world-wide). Multiplies the lean accumulation rate.
// At L10 effective: rate cut to 30% of base.
export function leanRateScale(effectiveLevel: number): number {
  return Math.max(0.05, 1 - 0.7 * levelToFraction(effectiveLevel))
}

// Sturdy foundation (world-wide). Adds degrees to the per-building collapse
// threshold. At L10 effective: +12° (so Pisa: 30° → 42°).
export const STURDY_BONUS_MAX_DEG = 12
export function sturdyAngleBonus(effectiveLevel: number): number {
  return STURDY_BONUS_MAX_DEG * levelToFraction(effectiveLevel)
}

// Plumb Line (personal). Each brick you collect straightens the building lean
// by an extra N degrees, on top of cfg.brickStraightenDeg.
export const PLUMB_PERSONAL_MAX_DEG = 6
export function plumbLinePersonalBonus(personalLevel: number): number {
  return PLUMB_PERSONAL_MAX_DEG * levelToFraction(personalLevel)
}

// Plumb Line Teacher (world-wide). Smaller flat bonus added on top of every
// brick collection in the room.
export const PLUMB_TEACHER_MAX_DEG = 3
export function plumbLineTeacherBonus(effectiveLevel: number): number {
  return PLUMB_TEACHER_MAX_DEG * levelToFraction(effectiveLevel)
}

// Generous Contribution (personal). Multiplies the value of bricks YOU collect
// when applied to building progress (and lifetime currency).
// At L10 personal: +50%.
export const GENEROUS_PERSONAL_MAX = 0.5
export function contributionPersonalBonus(personalLevel: number): number {
  return GENEROUS_PERSONAL_MAX * levelToFraction(personalLevel)
}

// Generous Teacher (world-wide). Smaller multiplier bonus applied to EVERY
// brick collected, scaled by world effective level. At L10 effective: +20%.
export const GENEROUS_TEACHER_MAX = 0.2
export function contributionTeacherBonus(effectiveLevel: number): number {
  return GENEROUS_TEACHER_MAX * levelToFraction(effectiveLevel)
}

// Stockpile (world-wide). Increases the active brick cap.
// base × (1 + 3 × fraction). 8 → 32 at L10 effective.
export function brickCapMultiplier(effectiveLevel: number): number {
  return 1 + 3 * levelToFraction(effectiveLevel)
}

// Tithe (personal). Multiplier bonus on the lifetime-contribution credit
// (the upgrade currency) — does NOT affect building progress.
// At L10 personal: +50%.
export const TITHE_PERSONAL_MAX = 0.5
export function titheBonus(personalLevel: number): number {
  return TITHE_PERSONAL_MAX * levelToFraction(personalLevel)
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
