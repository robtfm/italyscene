import { engine, PrimaryPointerInfo, Transform } from '@dcl/sdk/ecs'
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
  pickupRadius,
} from '../shared/upgrades'

const COMPLETION_CELEBRATION_S = 10

const piazzaRed = Color4.fromHexString('#c8233bff')
const panelGreen = Color4.create(0.06, 0.34, 0.18, 0.92)
const panelCream = Color4.create(0.96, 0.95, 0.92, 0.96)
const panelBlack = Color4.create(0, 0, 0, 0.55)
const black = Color4.Black()

let skillTreeOpen = false
let hoveredTooltip: string | null = null
let hoveredCardIndex = 0
const acknowledgedBuyables = new Set<string>()

function buyableKey(name: string, level: number) {
  return `${name}:${level}`
}

function currentlyBuyable(): Set<string> {
  const stats = getMyStats()
  const available = stats.lifetimeContributions - stats.bricksSpent
  const out = new Set<string>()
  if (stats.multiBricksLevel < MAX_MULTI_BRICK_LEVEL) {
    const cost = levelUpCost(stats.multiBricksLevel)
    if (available >= cost)
      out.add(buyableKey('multiBricks', stats.multiBricksLevel + 1))
  }
  if (stats.pickupRadiusLevel < MAX_MULTI_BRICK_LEVEL) {
    const cost = levelUpCost(stats.pickupRadiusLevel)
    if (available >= cost)
      out.add(buyableKey('pickupRadius', stats.pickupRadiusLevel + 1))
  }
  return out
}

function hasUnacknowledgedBuyable(): boolean {
  for (const k of currentlyBuyable()) {
    if (!acknowledgedBuyables.has(k)) return true
  }
  return false
}

function acknowledgeBuyables() {
  for (const k of currentlyBuyable()) acknowledgedBuyables.add(k)
}

const CARD_TOP = 110
const CARD_STRIDE = 110
const CARD_WIDTH = 220
const CARD_RIGHT_MARGIN = 12

const PANEL_OUTER_RADIUS = 12
const PANEL_INNER_RADIUS = 8

// Shared "green-frame around cream interior" panel used by every UI surface.
type PanelProps = {
  width?: any
  padding?: any
  margin?: any
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  children?: any
}
function framedPanel(p: PanelProps) {
  const padding = p.padding ?? 6
  return (
    <UiEntity
      uiTransform={{
        width: p.width,
        padding: 4,
        margin: p.margin,
        borderRadius: PANEL_OUTER_RADIUS,
      }}
      uiBackground={{ color: panelGreen }}
      onMouseEnter={p.onMouseEnter}
      onMouseLeave={p.onMouseLeave}
    >
      <UiEntity
        uiTransform={{
          width: '100%',
          flexDirection: 'column',
          alignItems: 'center',
          padding,
          borderRadius: PANEL_INNER_RADIUS,
        }}
        uiBackground={{ color: panelCream }}
      >
        {p.children}
      </UiEntity>
    </UiEntity>
  )
}

function darkRoundedPanel(p: {
  uiTransform: any
  children: any
}) {
  return (
    <UiEntity
      uiTransform={{ ...p.uiTransform, borderRadius: PANEL_INNER_RADIUS }}
      uiBackground={{ color: panelBlack }}
    >
      {p.children}
    </UiEntity>
  )
}

const BUTTON_RADIUS = 8

type RoundedButtonProps = {
  value: string
  variant?: 'primary' | 'secondary'
  width?: any
  height?: any
  fontSize?: number
  margin?: any
  color?: Color4
  onMouseDown?: () => void
}
function roundedButton(p: RoundedButtonProps) {
  // Spread color only when explicitly set; passing color={undefined} overrides
  // the variant's default text color.
  const colorProp = p.color ? { color: p.color } : {}
  return (
    <Button
      uiTransform={{
        width: p.width ?? 140,
        height: p.height ?? 32,
        margin: p.margin,
        borderRadius: BUTTON_RADIUS,
      }}
      value={p.value}
      variant={p.variant ?? 'primary'}
      fontSize={p.fontSize ?? 12}
      onMouseDown={p.onMouseDown}
      {...colorProp}
    />
  )
}

function lerpColor(a: Color4, b: Color4, t: number): Color4 {
  return Color4.create(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t,
    a.a + (b.a - a.a) * t
  )
}

const popHot = Color4.fromHexString('#ffd24aff')

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(uiComponent)
}

const uiComponent = () => (
  <UiEntity
    uiTransform={{
      width: '100%',
      height: '100%',
      positionType: 'absolute',
    }}
  >
    {topCenter()}
    {rightEdge()}
    {bottomActions()}
    {hoveredTooltip ? tooltipBox(hoveredTooltip) : null}
    {skillTreeOpen ? skillTreeModal() : null}
  </UiEntity>
)

function topCenter() {
  const active = getActiveBuildingState()
  const completionLine =
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
        )}% (${active.bricksRequired} bricks)`

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 16 },
        width: '100%',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {framedPanel({
        width: 380,
        padding: 8,
        children: (
          <UiEntity
            uiTransform={{
              width: '100%',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <Label
              value={completionLine}
              fontSize={16}
              color={
                active?.collapsing
                  ? piazzaRed
                  : active && active.completedTime > 0
                  ? piazzaRed
                  : black
              }
              uiTransform={{ width: '100%', height: 22 }}
            />
            <Label
              value={`Lean: ${active ? active.displayLean.toFixed(1) : '0.0'}°`}
              fontSize={12}
              color={active && active.displayLean > 25 ? piazzaRed : black}
              uiTransform={{ width: '100%', height: 18 }}
            />
            <Label
              value={`Bricks collected: ${getBrickCount()}    Your bricks: ${getMyContribution()}`}
              fontSize={13}
              color={black}
              uiTransform={{ width: '100%', height: 20 }}
            />
          </UiEntity>
        ),
      })}
    </UiEntity>
  )
}

function rightEdge() {
  const stats = getMyStats()
  const eff = getEffectiveMultiBricksLevel()
  const chances = multiBricksChances(eff)
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: CARD_TOP, right: CARD_RIGHT_MARGIN },
        width: CARD_WIDTH,
        flexDirection: 'column',
      }}
    >
      {powerupCard({
        index: 0,
        title: 'Multi-bricks',
        tooltip:
          'Bricks may spawn in stacks. World-wide effect — combines harmonically across active players. Your level adds to the pool.',
        lines: [
          `Effective L${eff.toFixed(2)}`,
          `Double: ${(chances.double * 100).toFixed(1)}%`,
          `Triple: ${(chances.triple * 100).toFixed(1)}%`,
          `Your level: ${stats.multiBricksLevel}`,
        ],
      })}
      {powerupCard({
        index: 1,
        title: 'Pickup radius',
        tooltip:
          'Lets you collect bricks from further away. Personal — only your own level affects your reach.',
        lines: [
          `Your level: ${stats.pickupRadiusLevel}`,
          `Reach: ${pickupRadius(stats.pickupRadiusLevel).toFixed(1)} m`,
        ],
      })}
    </UiEntity>
  )
}

function powerupCard(opts: {
  index: number
  title: string
  tooltip: string
  lines: string[]
}) {
  return framedPanel({
    width: '100%',
    margin: '0 0 8px 0',
    onMouseEnter: () => {
      hoveredTooltip = opts.tooltip
      hoveredCardIndex = opts.index
    },
    onMouseLeave: () => {
      if (hoveredTooltip === opts.tooltip) hoveredTooltip = null
    },
    children: (
      <UiEntity
        uiTransform={{
          width: '100%',
          flexDirection: 'column',
        }}
      >
        <Label
          value={opts.title}
          fontSize={13}
          color={piazzaRed}
          uiTransform={{ width: '100%', height: 18 }}
        />
        {opts.lines.map((line, i) => (
          <Label
            key={i}
            value={line}
            fontSize={11}
            color={black}
            uiTransform={{ width: '100%', height: 16 }}
          />
        ))}
      </UiEntity>
    ),
  })
}

function tooltipBox(text: string) {
  const ptr = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  const tooltipWidth = 280
  const tooltipHeightApprox = 80
  // Anchor RIGHT side of tooltip near cursor: tooltip extends to the left
  // and slightly above. Suits right-edge panels where extending rightward
  // would clip off-screen.
  let left = 32
  let top = 32
  if (ptr?.screenCoordinates) {
    left = Math.max(8, ptr.screenCoordinates.x - tooltipWidth - 12)
    top = Math.max(8, ptr.screenCoordinates.y - tooltipHeightApprox - 8)
  }
  return darkRoundedPanel({
    uiTransform: {
      positionType: 'absolute',
      position: { top, left },
      width: tooltipWidth,
      padding: 8,
    },
    children: (
      <Label
        value={text}
        fontSize={11}
        color={Color4.White()}
        uiTransform={{ width: '100%' }}
      />
    ),
  })
}

function bottomActions() {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { bottom: 16 },
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {(() => {
        const popping = hasUnacknowledgedBuyable()
        // Smooth sine pulse: 0..1 cycling at ~1.6Hz
        const pulse = popping
          ? (Math.sin((Date.now() / 1000) * Math.PI * 1.6) + 1) / 2
          : 0
        // Slot stays the size of the maximum popping button so growth doesn't
        // shove neighbours around. Button centered inside.
        const SKILL_SLOT_WIDTH = 210
        const SKILL_SLOT_HEIGHT = 44
        return (
          <UiEntity
            uiTransform={{
              width: SKILL_SLOT_WIDTH,
              height: SKILL_SLOT_HEIGHT,
              margin: '0 4px',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {roundedButton({
              value: popping ? 'Skill tree (NEW)' : 'Skill tree',
              variant: 'primary',
              width: popping ? 170 + 24 * pulse : 140,
              height: popping ? 32 + 6 * pulse : 32,
              fontSize: 13,
              color: popping
                ? lerpColor(Color4.White(), popHot, pulse)
                : undefined,
              onMouseDown: () => {
                acknowledgeBuyables()
                skillTreeOpen = true
              },
            })}
          </UiEntity>
        )
      })()}
      {roundedButton({
        value: 'DEBUG: +1 brick',
        variant: 'secondary',
        margin: '0 4px',
        fontSize: 11,
        onMouseDown: () => room.send('debugAddBrick', { ts: Date.now() }),
      })}
    </UiEntity>
  )
}

function skillTreeModal() {
  const stats = getMyStats()
  const eff = getEffectiveMultiBricksLevel()
  const available = stats.lifetimeContributions - stats.bricksSpent

  const mbCost = levelUpCost(stats.multiBricksLevel)
  const canMb =
    stats.multiBricksLevel < MAX_MULTI_BRICK_LEVEL && available >= mbCost
  const prCost = levelUpCost(stats.pickupRadiusLevel)
  const canPr =
    stats.pickupRadiusLevel < MAX_MULTI_BRICK_LEVEL && available >= prCost

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      uiBackground={{ color: panelBlack }}
      onMouseDown={() => {
        skillTreeOpen = false
      }}
    >
      <UiEntity
        uiTransform={{ width: 460 }}
        onMouseDown={() => {
          /* swallow click so it doesn't close the modal */
        }}
      >
        {framedPanel({
          width: '100%',
          padding: 12,
          children: (
            <UiEntity
              uiTransform={{
                width: '100%',
                flexDirection: 'column',
                alignItems: 'center',
              }}
            >
              <Label
                value="Skill tree"
                fontSize={20}
                color={piazzaRed}
                uiTransform={{ width: '100%', height: 30 }}
              />
              <Label
                value={`Available bricks: ${available}    (lifetime ${stats.lifetimeContributions} − spent ${stats.bricksSpent})`}
                fontSize={11}
                color={black}
                uiTransform={{ width: '100%', height: 18, margin: '0 0 6px 0' }}
              />

              {skillRow({
                title: `Multi-bricks  L${stats.multiBricksLevel}`,
                sub: `World-wide. Effective ${eff.toFixed(2)}.`,
                cost: mbCost,
                atMax: stats.multiBricksLevel >= MAX_MULTI_BRICK_LEVEL,
                canBuy: canMb,
                onBuy: () =>
                  room.send('levelUpMultiBricks', { ts: Date.now() }),
              })}
              {skillRow({
                title: `Pickup radius  L${stats.pickupRadiusLevel}`,
                sub: `Personal. Reach ${pickupRadius(stats.pickupRadiusLevel).toFixed(1)} m.`,
                cost: prCost,
                atMax: stats.pickupRadiusLevel >= MAX_MULTI_BRICK_LEVEL,
                canBuy: canPr,
                onBuy: () =>
                  room.send('levelUpPickupRadius', { ts: Date.now() }),
              })}

              {roundedButton({
                value: 'Close',
                variant: 'secondary',
                width: 100,
                height: 28,
                margin: '12px 0 0 0',
                onMouseDown: () => {
                  skillTreeOpen = false
                },
              })}
            </UiEntity>
          ),
        })}
      </UiEntity>
    </UiEntity>
  )
}

function skillRow(opts: {
  title: string
  sub: string
  cost: number
  atMax: boolean
  canBuy: boolean
  onBuy: () => void
}) {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 6,
        margin: '4px 0',
        borderRadius: 6,
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.05) }}
    >
      <UiEntity
        uiTransform={{
          width: 260,
          flexDirection: 'column',
        }}
      >
        <Label
          value={opts.title}
          fontSize={14}
          color={black}
          uiTransform={{ width: '100%', height: 20 }}
        />
        <Label
          value={opts.sub}
          fontSize={11}
          color={black}
          uiTransform={{ width: '100%', height: 16 }}
        />
      </UiEntity>
      {roundedButton({
        value: opts.atMax
          ? 'MAX'
          : opts.canBuy
          ? `Level up (${opts.cost})`
          : `Need ${opts.cost}`,
        variant: opts.canBuy ? 'primary' : 'secondary',
        width: 150,
        height: 28,
        fontSize: 11,
        onMouseDown: () => {
          if (opts.canBuy && !opts.atMax) opts.onBuy()
        },
      })}
    </UiEntity>
  )
}

// Kept for legacy import path; player position no longer in the UI but
// might be useful for debugging if reattached later.
export function getPlayerPosition() {
  const t = Transform.getOrNull(engine.PlayerEntity)
  if (!t) return 'incoming...'
  const { x, y, z } = t.position
  return `{X: ${x.toFixed(1)}, Y: ${y.toFixed(1)}, Z: ${z.toFixed(1)}}`
}
