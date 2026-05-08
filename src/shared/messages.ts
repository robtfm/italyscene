import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
  collectBrick: Schemas.Map({ brickId: Schemas.Int }),
  debugAddBrick: Schemas.Map({ ts: Schemas.Int }),
  contributionUpdate: Schemas.Map({ count: Schemas.Int }),
  myStatsUpdate: Schemas.Map({
    lifetimeContributions: Schemas.Int,
    bricksSpent: Schemas.Int,
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
}

export const room = registerMessages(Messages)
