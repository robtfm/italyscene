import { engine, Transform, pointerEventsSystem, InputAction } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import ReactEcs, {
  Button,
  Label,
  ReactEcsRenderer,
  UiEntity,
} from '@dcl/sdk/react-ecs'
import {
  getBrickCount,
  getActiveBuildingState,
  getMyContribution,
  getMyStats,
  getEffectiveMultiBricksLevel,
} from './setup'
import { room } from '../shared/messages'
import {
  levelUpCost,
  multiBricksChances,
  MAX_MULTI_BRICK_LEVEL,
} from '../shared/upgrades'

const greetings = ['Hi!', 'Good morning!', 'Lovely!', 'Goodness!', 'Good evening!']
let fountainClicks = 0
let currentGreeting = 'Welcome to the piazza'

export function registerFountainClick() {
  fountainClicks += 1
  currentGreeting = greetings[fountainClicks % greetings.length]
}

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(uiComponent)

  const fountain = engine.getEntityOrNullByName('Fountain')
  if (fountain) {
    pointerEventsSystem.onPointerDown(
      {
        entity: fountain,
        opts: { button: InputAction.IA_PRIMARY, hoverText: 'Touch the fountain' },
      },
      () => registerFountainClick()
    )
  }
}

const piazzaGreen = Color4.fromHexString('#0f8a4cff')
const piazzaWhite = Color4.fromHexString('#f6f3ecff')
const piazzaRed = Color4.fromHexString('#c8233bff')

const COMPLETION_CELEBRATION_S = 10

const uiComponent = () => {
  const active = getActiveBuildingState()
  const stats = getMyStats()
  const eff = getEffectiveMultiBricksLevel()
  const chances = multiBricksChances(eff)
  const available = stats.lifetimeContributions - stats.bricksSpent
  const nextCost = levelUpCost(stats.multiBricksLevel)
  const canLevelUp =
    stats.multiBricksLevel < MAX_MULTI_BRICK_LEVEL && available >= nextCost

  return (
    <UiEntity
      uiTransform={{
        width: 420,
        height: 360,
        margin: '16px 0 8px 270px',
        padding: 6,
      }}
      uiBackground={{ color: piazzaGreen }}
    >
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 6,
        }}
        uiBackground={{ color: piazzaWhite }}
      >
        <Label
          value="Italian Piazza"
          fontSize={22}
          color={piazzaRed}
          uiTransform={{ width: '100%', height: 32 }}
        />
        <Label
          value={currentGreeting}
          fontSize={18}
          color={Color4.Black()}
          uiTransform={{ width: '100%', height: 28 }}
        />
        <Label
          value={`Bricks collected: ${getBrickCount()}`}
          fontSize={16}
          color={piazzaRed}
          uiTransform={{ width: '100%', height: 26 }}
        />
        <Label
          value={`Your bricks: ${getMyContribution()}  (avail ${available})`}
          fontSize={13}
          color={Color4.Black()}
          uiTransform={{ width: '100%', height: 20 }}
        />
        <Label
          value={`Multi-bricks effective L${eff.toFixed(2)}: ${(chances.double * 100).toFixed(1)}% double, ${(chances.triple * 100).toFixed(1)}% triple`}
          fontSize={11}
          color={piazzaRed}
          uiTransform={{ width: '100%', height: 18 }}
        />
        <Label
          value={
            stats.multiBricksLevel >= MAX_MULTI_BRICK_LEVEL
              ? `Your multi-bricks: L${stats.multiBricksLevel} (max)`
              : `Your multi-bricks: L${stats.multiBricksLevel}  next costs ${nextCost}`
          }
          fontSize={11}
          color={Color4.Black()}
          uiTransform={{ width: '100%', height: 18 }}
        />
        <Button
          uiTransform={{ width: 200, height: 26, margin: 2 }}
          value={
            stats.multiBricksLevel >= MAX_MULTI_BRICK_LEVEL
              ? 'Multi-bricks: MAX'
              : canLevelUp
              ? `Level up (${nextCost} bricks)`
              : `Need ${nextCost} bricks`
          }
          variant={canLevelUp ? 'primary' : 'secondary'}
          fontSize={11}
          onMouseDown={() => {
            if (canLevelUp) room.send('levelUpMultiBricks', { ts: Date.now() })
          }}
        />
        <Label
          value={
            active === null
              ? 'Building: …'
              : active.collapsing
              ? `${active.displayName}: COLLAPSING!!!`
              : active.completedTime > 0
              ? `${active.displayName}: COMPLETE — next in ${Math.max(
                  0,
                  COMPLETION_CELEBRATION_S - active.completedTime
                ).toFixed(1)}s`
              : `${active.displayName}: ${Math.round(
                  active.riseProgress * 100
                )}%`
          }
          fontSize={14}
          color={active?.collapsing ? piazzaRed : Color4.Black()}
          uiTransform={{ width: '100%', height: 22 }}
        />
        <Label
          value={`Lean: ${active ? active.displayLean.toFixed(1) : '0.0'}°`}
          fontSize={12}
          color={
            active && active.displayLean > 25 ? piazzaRed : Color4.Black()
          }
          uiTransform={{ width: '100%', height: 18 }}
        />
        <Label
          value={`Fountain taps: ${fountainClicks}`}
          fontSize={12}
          color={Color4.Black()}
          uiTransform={{ width: '100%', height: 20 }}
        />
        <Label
          value={`Position: ${getPlayerPosition()}`}
          fontSize={11}
          color={Color4.Black()}
          uiTransform={{ width: '100%', height: 18 }}
        />
        <Button
          uiTransform={{ width: 160, height: 26, margin: 2 }}
          value="DEBUG: +1 brick"
          variant="secondary"
          fontSize={10}
          onMouseDown={() => room.send('debugAddBrick', { ts: Date.now() })}
        />
      </UiEntity>
    </UiEntity>
  )
}

function getPlayerPosition() {
  const playerPosition = Transform.getOrNull(engine.PlayerEntity)
  if (!playerPosition) return 'incoming...'
  const { x, y, z } = playerPosition.position
  return `{X: ${x.toFixed(1)}, Y: ${y.toFixed(1)}, Z: ${z.toFixed(1)}}`
}
