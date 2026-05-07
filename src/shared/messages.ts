import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
  collectBrick: Schemas.Map({ brickId: Schemas.Int }),
  debugAddBrick: Schemas.Map({ ts: Schemas.Int }),
  contributionUpdate: Schemas.Map({ count: Schemas.Int }),
}

export const room = registerMessages(Messages)
