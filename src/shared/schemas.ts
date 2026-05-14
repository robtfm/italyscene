import { engine, Schemas } from '@dcl/sdk/ecs'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

export const WorldState = engine.defineComponent('italyscene:WorldState', {
  brickCount: Schemas.Float,
  currentBuildingKey: Schemas.String,
  effectiveMultiBricksLevel: Schemas.Float,
  effectiveFasterSpawnsLevel: Schemas.Float,
  effectiveLeanDampenerLevel: Schemas.Float,
  effectiveSturdyFoundationLevel: Schemas.Float,
  effectivePlumbTeacherLevel: Schemas.Float,
  effectiveGenerousTeacherLevel: Schemas.Float,
  effectiveStockpileLevel: Schemas.Float,
})

export const BuildingState = engine.defineComponent('italyscene:BuildingState', {
  buildingKey: Schemas.String,
  // Per-building progression: increments on each successful completion.
  // Higher level → more bricks required, less straighten per brick.
  level: Schemas.Int,
  riseProgress: Schemas.Float,
  currentLean: Schemas.Float,
  collapsing: Schemas.Boolean,
  collapseTime: Schemas.Float,
  collapseStartProgress: Schemas.Float,
  baseGroundY: Schemas.Float,
  baseInitialized: Schemas.Boolean,
  completedTime: Schemas.Float,
  // Date.now() (ms) of the most recent completion. Clients render the
  // building at its completed state for an hour after this timestamp;
  // re-activation (next pick) zeroes the field via transitionToBuilding.
  lastCompletedAt: Schemas.Int64,
})

export const Brick = engine.defineComponent('italyscene:Brick', {
  brickId: Schemas.Int,
  value: Schemas.Int,
  spawnedAt: Schemas.Int64,
  // Server-picked spawn XZ. Y is resolved per-client by a downward raycast
  // (the server can't see physics colliders), so Transform isn't synced.
  x: Schemas.Float,
  z: Schemas.Float,
})

const fromServerOnly = (value: { senderAddress: string }) =>
  value.senderAddress.toLowerCase() === AUTH_SERVER_PEER_ID.toLowerCase()

WorldState.validateBeforeChange(fromServerOnly)
BuildingState.validateBeforeChange(fromServerOnly)
Brick.validateBeforeChange(fromServerOnly)
