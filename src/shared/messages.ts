import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
  collectBrick: Schemas.Map({ brickId: Schemas.Int }),
  // Server broadcasts to all clients on each collection. Drives the visual
  // flight effect; no game-state side effect (state is already changed).
  // y is not sent — server doesn't know it; clients look up the brick's
  // local Transform y by brickId for the flight start position.
  brickCollected: Schemas.Map({
    brickId: Schemas.Int,
    x: Schemas.Float,
    z: Schemas.Float,
    value: Schemas.Int,
  }),
  debugAddBrick: Schemas.Map({ ts: Schemas.Int }),
  contributionUpdate: Schemas.Map({ count: Schemas.Int }),
  myStatsUpdate: Schemas.Map({
    prestigeLevel: Schemas.Int,
    lifetimeContributions: Schemas.Int,
    bricksSpent: Schemas.Int,
    // Player's pool-unlock pointer: pool index = 0..availableBuildings is
    // the set of (building, level) pairs the player can have spawned.
    availableBuildings: Schemas.Int,
    multiBricksLevel: Schemas.Int,
    pickupRadiusLevel: Schemas.Int,
    fasterSpawnsLevel: Schemas.Int,
    leanDampenerLevel: Schemas.Int,
    sturdyFoundationLevel: Schemas.Int,
    plumbLineLevel: Schemas.Int,
    plumbTeacherLevel: Schemas.Int,
    generousLevel: Schemas.Int,
    generousTeacherLevel: Schemas.Int,
    stockpileLevel: Schemas.Int,
    titheLevel: Schemas.Int,
    // World-effective harmonic level if THIS player levels up the global skill
    // by 1 (others held constant). Lets the client preview its impact.
    nextEffectiveMultiBricksLevel: Schemas.Float,
    nextEffectiveFasterSpawnsLevel: Schemas.Float,
    nextEffectiveLeanDampenerLevel: Schemas.Float,
    nextEffectiveSturdyFoundationLevel: Schemas.Float,
    nextEffectivePlumbTeacherLevel: Schemas.Float,
    nextEffectiveGenerousTeacherLevel: Schemas.Float,
    nextEffectiveStockpileLevel: Schemas.Float,
    // JSON-encoded Record<buildingKey, number> of this player's highest
    // level personally beaten per building. Drives gate checks for
    // upgrades that require a specific building at a specific level.
    maxBuildingLevelJson: Schemas.String,
    // JSON-encoded snapshot taken at last prestige; drives the 2^N
    // personal income multiplier per building.
    prestigedMaxBuildingLevelJson: Schemas.String,
    // JSON-encoded Record<upgradeKey, number>: free starting levels per
    // upgrade, chosen at each Renaissance. Used by the cost formula:
    // cost = levelUpCost(totalLevel - perk, key).
    perkPointsJson: Schemas.String,
  }),
  levelUpMultiBricks: Schemas.Map({ ts: Schemas.Int }),
  levelUpPickupRadius: Schemas.Map({ ts: Schemas.Int }),
  levelUpFasterSpawns: Schemas.Map({ ts: Schemas.Int }),
  levelUpLeanDampener: Schemas.Map({ ts: Schemas.Int }),
  levelUpSturdyFoundation: Schemas.Map({ ts: Schemas.Int }),
  levelUpPlumbLine: Schemas.Map({ ts: Schemas.Int }),
  levelUpPlumbTeacher: Schemas.Map({ ts: Schemas.Int }),
  levelUpGenerous: Schemas.Map({ ts: Schemas.Int }),
  levelUpGenerousTeacher: Schemas.Map({ ts: Schemas.Int }),
  levelUpStockpile: Schemas.Map({ ts: Schemas.Int }),
  levelUpTithe: Schemas.Map({ ts: Schemas.Int }),
  // Player-initiated reset: zeroes currency + all upgrade levels +
  // availableBuildings; keeps maxBuildingLevel. The kept maxes drive a
  // 2^max income multiplier per building on every brick the player
  // collects there.
  // Client -> server: trigger Renaissance with the chosen perk allocation.
  // allocationJson is a Record<upgradeKey, number>; server validates the
  // sum is within the player's earned pool before applying.
  prestige: Schemas.Map({
    ts: Schemas.Int,
    allocationJson: Schemas.String,
  }),
  // Server -> single contributor: their per-building max just rose to this
  // level. Drives the in-scene "Tower of Pisa Lv 3!" popup.
  buildingMaxAdvanced: Schemas.Map({
    buildingKey: Schemas.String,
    level: Schemas.Int,
  }),
  // Server -> the prestiging player: fires once their prestige goes through.
  // advancesJson is a JSON-encoded array of { buildingKey, level } for every
  // building whose snapshot bumped, used to summarise the income multiplier
  // change.
  prestigeResult: Schemas.Map({
    prestigeLevel: Schemas.Int,
    advancesJson: Schemas.String,
  }),
  // Client -> server: open the leaderboard modal and request snapshot for
  // this category. Category ids: 'total', 'bricks', 'building:<entityName>',
  // 'skill:<levelKey>'.
  leaderboardRequest: Schemas.Map({
    category: Schemas.String,
    ts: Schemas.Int,
  }),
  // Server -> caller: top-10 entries plus the caller's own rank/score. rank
  // is 0-indexed (0 = first place); −1 means "outside top 10". entriesJson
  // is a JSON array of { address, score, achievedAt }.
  leaderboardSnapshot: Schemas.Map({
    category: Schemas.String,
    entriesJson: Schemas.String,
    myRank: Schemas.Int,
    myScore: Schemas.Int,
    myName: Schemas.String,
    myAvatarUrl: Schemas.String,
  }),
  // Server -> caller: fired once on first connection (no stored profile)
  // so the client can show the onboarding popup.
  welcomeNewPlayer: Schemas.Map({ ts: Schemas.Int }),
  // Preview-only: wipe the calling player's stored profile so the next
  // join shows the welcome popup again. Server clears the cached promise
  // and re-sends a fresh-default sendMyStats.
  debugWipeProfile: Schemas.Map({ ts: Schemas.Int }),
}

export const room = registerMessages(Messages)
