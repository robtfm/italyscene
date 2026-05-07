import { engine, Schemas } from '@dcl/sdk/ecs'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

export const WorldState = engine.defineComponent('italyscene:WorldState', {
  brickCount: Schemas.Int,
})

export const BuildingState = engine.defineComponent('italyscene:BuildingState', {
  buildingKey: Schemas.String,
  riseProgress: Schemas.Float,
  currentLean: Schemas.Float,
  collapsing: Schemas.Boolean,
  collapseTime: Schemas.Float,
  collapseStartProgress: Schemas.Float,
  baseGroundY: Schemas.Float,
  baseInitialized: Schemas.Boolean,
})

export const Brick = engine.defineComponent('italyscene:Brick', {
  brickId: Schemas.Int,
  value: Schemas.Int,
  spawnedAt: Schemas.Int64,
})

const fromServerOnly = (value: { senderAddress: string }) =>
  value.senderAddress.toLowerCase() === AUTH_SERVER_PEER_ID.toLowerCase()

WorldState.validateBeforeChange(fromServerOnly)
BuildingState.validateBeforeChange(fromServerOnly)
Brick.validateBeforeChange(fromServerOnly)
