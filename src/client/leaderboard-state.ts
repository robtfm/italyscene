// Cache of leaderboard snapshots received from the server, keyed by category
// id. ui.tsx reads from here; setup.ts pushes from the room.onMessage
// handler. Lives in its own module to keep setup.ts and ui.tsx from cross-
// importing (same pattern as brick-state and popup-state).
export type LBEntry = {
  address: string
  score: number
  achievedAt: number
  // Profile fields (resolved server-side via Catalyst lambdas). Either may be
  // empty when the user has no display name / avatar snapshot yet.
  name?: string
  avatarUrl?: string
}
export type LBSnapshot = {
  category: string
  entries: LBEntry[]
  myRank: number // -1 if outside top10
  myScore: number
  myName?: string
  myAvatarUrl?: string
  fetchedAt: number
}

const snapshots = new Map<string, LBSnapshot>()

export function setLeaderboardSnapshot(s: LBSnapshot) {
  snapshots.set(s.category, s)
}

export function getLeaderboardSnapshot(category: string): LBSnapshot | null {
  return snapshots.get(category) ?? null
}
