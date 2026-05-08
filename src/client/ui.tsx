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
  getEffectiveFasterSpawnsLevel,
  getEffectiveLeanDampenerLevel,
  getEffectiveSturdyFoundationLevel,
  getEffectivePlumbTeacherLevel,
  getEffectiveGenerousTeacherLevel,
  getEffectiveStockpileLevel,
} from './setup'
import { room } from '../shared/messages'
import {
  brickCapMultiplier,
  contributionPersonalBonus,
  contributionTeacherBonus,
  gateBlockingFor,
  isAtEffectiveMax,
  isAtMax,
  leanRateScale,
  levelUpCost,
  maxBrickStack,
  pickupRadius,
  plumbLinePersonalBonus,
  plumbLineTeacherBonus,
  spawnIntervalScale,
  sturdyAngleBonus,
  titheBonus,
} from '../shared/upgrades'
import { BUILDING_CONFIGS } from '../shared/buildings'

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

const ALL_UPGRADES: { key: string; getter: (s: ReturnType<typeof getMyStats>) => number }[] = [
  { key: 'multiBricksLevel', getter: (s) => s.multiBricksLevel },
  { key: 'pickupRadiusLevel', getter: (s) => s.pickupRadiusLevel },
  { key: 'fasterSpawnsLevel', getter: (s) => s.fasterSpawnsLevel },
  { key: 'leanDampenerLevel', getter: (s) => s.leanDampenerLevel },
  { key: 'sturdyFoundationLevel', getter: (s) => s.sturdyFoundationLevel },
  { key: 'plumbLineLevel', getter: (s) => s.plumbLineLevel },
  { key: 'plumbTeacherLevel', getter: (s) => s.plumbTeacherLevel },
  { key: 'generousLevel', getter: (s) => s.generousLevel },
  { key: 'generousTeacherLevel', getter: (s) => s.generousTeacherLevel },
  { key: 'stockpileLevel', getter: (s) => s.stockpileLevel },
  { key: 'titheLevel', getter: (s) => s.titheLevel },
]

function currentlyBuyable(): Set<string> {
  const stats = getMyStats()
  const available = stats.lifetimeContributions - stats.bricksSpent
  const out = new Set<string>()
  for (const u of ALL_UPGRADES) {
    const lvl = u.getter(stats)
    if (isAtEffectiveMax(u.key, lvl, stats.maxBuildingLevel)) continue
    if (available >= levelUpCost(lvl, u.key)) out.add(buyableKey(u.key, lvl + 1))
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
  // level field starts at 0 (first attempt) and increments per completion;
  // display 1-indexed so "Lv 1" is the fresh starting point.
  const titleWithLevel = active
    ? `${active.displayName} Lv ${active.level + 1}`
    : null
  const completionLine =
    active === null
      ? 'Building: …'
      : active.collapsing
      ? `${titleWithLevel}: COLLAPSING!!!`
      : active.completedTime > 0
      ? `${titleWithLevel}: COMPLETE — next in ${Math.max(
          0,
          COMPLETION_CELEBRATION_S - active.completedTime
        ).toFixed(1)}s`
      : `${titleWithLevel}: ${Math.round(
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

const ICON_PLACEHOLDER = 'images/upgrades/placeholder.png'

type UpgradeInfo = {
  title: string
  description: string
  formatEffect: (level: number) => string
}
const UPGRADE_INFO: Record<string, UpgradeInfo> = {
  multiBricks: {
    title: 'Brick Bonus',
    description:
      'Bricks spawn in stacks of 1 up to (level+1), skewed toward smaller stacks. World-wide — combines harmonically across active players.',
    formatEffect: (L) => {
      const max = maxBrickStack(L)
      return max === 1 ? '1' : `1–${max}`
    },
  },
  pickupRadius: {
    title: "Builder's Reach",
    description:
      'Click bricks from further away. Personal — only your own level affects your reach.',
    formatEffect: (L) => `${pickupRadius(L).toFixed(1)} m`,
  },
  fasterSpawns: {
    title: 'Supply Lines',
    description:
      'Bricks spawn more often. World-wide; harmonically stacked across active players.',
    formatEffect: (L) => `× ${spawnIntervalScale(L).toFixed(2)}`,
  },
  leanDampener: {
    title: 'Scaffolding',
    description:
      'Buildings lean over more slowly. World-wide; harmonically stacked across active players.',
    formatEffect: (L) => `× ${leanRateScale(L).toFixed(2)}`,
  },
  sturdyFoundation: {
    title: 'Opus Romano',
    description:
      'Buildings tolerate more lean before collapsing. World-wide; harmonically stacked.',
    formatEffect: (L) => `+${sturdyAngleBonus(L).toFixed(1)}°`,
  },
  plumbLine: {
    title: 'Plumb Line',
    description:
      'Each brick YOU collect straightens lean by a few extra degrees. Personal — only your level affects your bricks.',
    formatEffect: (L) => `+${plumbLinePersonalBonus(L).toFixed(1)}°`,
  },
  plumbTeacher: {
    title: 'Plumb Maestro',
    description:
      'A small extra straighten bonus added on top of EVERY brick collection in the room. World-wide; harmonically stacked.',
    formatEffect: (L) => `+${plumbLineTeacherBonus(L).toFixed(1)}°`,
  },
  generous: {
    title: 'Artful Contribution',
    description:
      'Each brick YOU collect counts as more toward the building. Personal — only boosts the building, not your currency.',
    formatEffect: (L) =>
      `+${(contributionPersonalBonus(L) * 100).toFixed(0)}%`,
  },
  generousTeacher: {
    title: 'Artful Maestro',
    description:
      'A small extra value bonus on EVERY brick collection in the room. World-wide; harmonically stacked.',
    formatEffect: (L) =>
      `+${(contributionTeacherBonus(L) * 100).toFixed(0)}%`,
  },
  stockpile: {
    title: 'Stockpile',
    description:
      'Raises the cap on how many bricks can be on the field at once. World-wide; harmonically stacked across active players.',
    formatEffect: (L) => `× ${brickCapMultiplier(L).toFixed(2)}`,
  },
  tithe: {
    title: "Padrone's Cut",
    description:
      "Keep a bigger cut of every brick you collect for upgrade currency. Doesn't help the building — only your spend power.",
    formatEffect: (L) => `+${(titheBonus(L) * 100).toFixed(0)}%`,
  },
}

function rightEdge() {
  const stats = getMyStats()
  const mb = getEffectiveMultiBricksLevel()
  const fs = getEffectiveFasterSpawnsLevel()
  const ld = getEffectiveLeanDampenerLevel()
  const sf = getEffectiveSturdyFoundationLevel()
  const pt = getEffectivePlumbTeacherLevel()
  const gt = getEffectiveGenerousTeacherLevel()
  const sk = getEffectiveStockpileLevel()
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: CARD_TOP, right: CARD_RIGHT_MARGIN },
        width: CARD_WIDTH,
        flexDirection: 'column',
      }}
    >
      {sectionHeader('Global')}
      {powerupCard({
        ...UPGRADE_INFO.multiBricks,
        valueText: UPGRADE_INFO.multiBricks.formatEffect(mb),
        yourLevel: stats.multiBricksLevel,
        effectiveLevel: mb,
        isGlobal: true,
      })}
      {powerupCard({
        ...UPGRADE_INFO.fasterSpawns,
        valueText: UPGRADE_INFO.fasterSpawns.formatEffect(fs),
        yourLevel: stats.fasterSpawnsLevel,
        effectiveLevel: fs,
        isGlobal: true,
      })}
      {powerupCard({
        ...UPGRADE_INFO.leanDampener,
        valueText: UPGRADE_INFO.leanDampener.formatEffect(ld),
        yourLevel: stats.leanDampenerLevel,
        effectiveLevel: ld,
        isGlobal: true,
      })}
      {powerupCard({
        ...UPGRADE_INFO.sturdyFoundation,
        valueText: UPGRADE_INFO.sturdyFoundation.formatEffect(sf),
        yourLevel: stats.sturdyFoundationLevel,
        effectiveLevel: sf,
        isGlobal: true,
      })}
      {powerupCard({
        ...UPGRADE_INFO.plumbTeacher,
        valueText: UPGRADE_INFO.plumbTeacher.formatEffect(pt),
        yourLevel: stats.plumbTeacherLevel,
        effectiveLevel: pt,
        isGlobal: true,
      })}
      {powerupCard({
        ...UPGRADE_INFO.generousTeacher,
        valueText: UPGRADE_INFO.generousTeacher.formatEffect(gt),
        yourLevel: stats.generousTeacherLevel,
        effectiveLevel: gt,
        isGlobal: true,
      })}
      {powerupCard({
        ...UPGRADE_INFO.stockpile,
        valueText: UPGRADE_INFO.stockpile.formatEffect(sk),
        yourLevel: stats.stockpileLevel,
        effectiveLevel: sk,
        isGlobal: true,
      })}

      {sectionHeader('Personal')}
      {powerupCard({
        ...UPGRADE_INFO.pickupRadius,
        valueText: UPGRADE_INFO.pickupRadius.formatEffect(stats.pickupRadiusLevel),
        yourLevel: stats.pickupRadiusLevel,
        isGlobal: false,
      })}
      {powerupCard({
        ...UPGRADE_INFO.plumbLine,
        valueText: UPGRADE_INFO.plumbLine.formatEffect(stats.plumbLineLevel),
        yourLevel: stats.plumbLineLevel,
        isGlobal: false,
      })}
      {powerupCard({
        ...UPGRADE_INFO.generous,
        valueText: UPGRADE_INFO.generous.formatEffect(stats.generousLevel),
        yourLevel: stats.generousLevel,
        isGlobal: false,
      })}
      {powerupCard({
        ...UPGRADE_INFO.tithe,
        valueText: UPGRADE_INFO.tithe.formatEffect(stats.titheLevel),
        yourLevel: stats.titheLevel,
        isGlobal: false,
      })}
    </UiEntity>
  )
}

function sectionHeader(text: string) {
  return (
    <Label
      value={text}
      fontSize={11}
      color={Color4.create(1, 1, 1, 0.85)}
      uiTransform={{
        width: '100%',
        height: 18,
        margin: '4px 0 4px 0',
      }}
      textAlign="middle-left"
    />
  )
}

function powerupCard(opts: {
  title: string
  description: string
  valueText: string
  yourLevel: number
  effectiveLevel?: number
  isGlobal: boolean
  iconPath?: string
}) {
  const leftHover = `${opts.title}\n\n${opts.description}`
  const rightHover = opts.isGlobal
    ? `${opts.title}\nYour level: ${opts.yourLevel}\nWorld effective: ${(opts.effectiveLevel ?? 0).toFixed(2)}`
    : `${opts.title}\nYour level: ${opts.yourLevel}`
  return framedPanel({
    width: '100%',
    margin: '0 0 6px 0',
    padding: 0,
    children: (
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 44,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <UiEntity
          uiTransform={{
            width: 44,
            height: 44,
            margin: '0 6px 0 0',
          }}
          uiBackground={{
            texture: { src: opts.iconPath ?? ICON_PLACEHOLDER },
            textureMode: 'stretch',
          }}
          onMouseEnter={() => {
            hoveredTooltip = leftHover
          }}
          onMouseLeave={() => {
            if (hoveredTooltip === leftHover) hoveredTooltip = null
          }}
        />
        <UiEntity
          uiTransform={{
            flexGrow: 1,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={() => {
            hoveredTooltip = rightHover
          }}
          onMouseLeave={() => {
            if (hoveredTooltip === rightHover) hoveredTooltip = null
          }}
        >
          <Label
            value={opts.valueText}
            fontSize={14}
            color={piazzaRed}
            uiTransform={{ width: '100%', height: 22 }}
            textAlign="middle-center"
          />
        </UiEntity>
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
      zIndex: 200,
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
  const mbEff = getEffectiveMultiBricksLevel()
  const fsEff = getEffectiveFasterSpawnsLevel()
  const ldEff = getEffectiveLeanDampenerLevel()
  const sfEff = getEffectiveSturdyFoundationLevel()
  const available = stats.lifetimeContributions - stats.bricksSpent

  const can = (key: string, level: number) =>
    !isAtEffectiveMax(key, level, stats.maxBuildingLevel) &&
    available >= levelUpCost(level, key)
  const lockReasonFor = (key: string, level: number): string | undefined => {
    if (isAtMax(key, level)) return undefined // hard cap → "MAX"
    const gate = gateBlockingFor(key, level, stats.maxBuildingLevel)
    if (!gate) return undefined
    const cfg = BUILDING_CONFIGS.find((c) => c.entityName === gate.building)
    const name = cfg?.displayName ?? gate.building
    // gate.required is already the 1-indexed Lv (matches the building banner).
    return `Beat ${name} Lv ${gate.required}`
  }

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
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
                ...UPGRADE_INFO.multiBricks,
                level: stats.multiBricksLevel,
                nowLevel: mbEff,
                nextLevel: stats.nextEffectiveMultiBricksLevel,
                sub: `World-wide. Effective ${mbEff.toFixed(2)}.`,
                cost: levelUpCost(stats.multiBricksLevel, 'multiBricksLevel'),
                atMax: isAtEffectiveMax('multiBricksLevel', stats.multiBricksLevel, stats.maxBuildingLevel),
                canBuy: can('multiBricksLevel', stats.multiBricksLevel),
                lockReason: lockReasonFor('multiBricksLevel', stats.multiBricksLevel),
                onBuy: () =>
                  room.send('levelUpMultiBricks', { ts: Date.now() }),
              })}
              {skillRow({
                ...UPGRADE_INFO.pickupRadius,
                level: stats.pickupRadiusLevel,
                nowLevel: stats.pickupRadiusLevel,
                nextLevel: stats.pickupRadiusLevel + 1,
                sub: `Personal. Reach ${pickupRadius(stats.pickupRadiusLevel).toFixed(1)} m.`,
                cost: levelUpCost(stats.pickupRadiusLevel, 'pickupRadiusLevel'),
                atMax: isAtEffectiveMax('pickupRadiusLevel', stats.pickupRadiusLevel, stats.maxBuildingLevel),
                canBuy: can('pickupRadiusLevel', stats.pickupRadiusLevel),
                lockReason: lockReasonFor('pickupRadiusLevel', stats.pickupRadiusLevel),
                onBuy: () =>
                  room.send('levelUpPickupRadius', { ts: Date.now() }),
              })}
              {skillRow({
                ...UPGRADE_INFO.fasterSpawns,
                level: stats.fasterSpawnsLevel,
                nowLevel: fsEff,
                nextLevel: stats.nextEffectiveFasterSpawnsLevel,
                sub: `World-wide. Effective ${fsEff.toFixed(2)}, interval × ${spawnIntervalScale(fsEff).toFixed(2)}.`,
                cost: levelUpCost(stats.fasterSpawnsLevel, 'fasterSpawnsLevel'),
                atMax: isAtEffectiveMax('fasterSpawnsLevel', stats.fasterSpawnsLevel, stats.maxBuildingLevel),
                canBuy: can('fasterSpawnsLevel', stats.fasterSpawnsLevel),
                lockReason: lockReasonFor('fasterSpawnsLevel', stats.fasterSpawnsLevel),
                onBuy: () =>
                  room.send('levelUpFasterSpawns', { ts: Date.now() }),
              })}
              {skillRow({
                ...UPGRADE_INFO.leanDampener,
                level: stats.leanDampenerLevel,
                nowLevel: ldEff,
                nextLevel: stats.nextEffectiveLeanDampenerLevel,
                sub: `World-wide. Effective ${ldEff.toFixed(2)}, lean rate × ${leanRateScale(ldEff).toFixed(2)}.`,
                cost: levelUpCost(stats.leanDampenerLevel, 'leanDampenerLevel'),
                atMax: isAtEffectiveMax('leanDampenerLevel', stats.leanDampenerLevel, stats.maxBuildingLevel),
                canBuy: can('leanDampenerLevel', stats.leanDampenerLevel),
                lockReason: lockReasonFor('leanDampenerLevel', stats.leanDampenerLevel),
                onBuy: () =>
                  room.send('levelUpLeanDampener', { ts: Date.now() }),
              })}
              {skillRow({
                ...UPGRADE_INFO.sturdyFoundation,
                level: stats.sturdyFoundationLevel,
                nowLevel: sfEff,
                nextLevel: stats.nextEffectiveSturdyFoundationLevel,
                sub: `World-wide. Effective ${sfEff.toFixed(2)}, threshold +${sturdyAngleBonus(sfEff).toFixed(1)}°.`,
                cost: levelUpCost(stats.sturdyFoundationLevel, 'sturdyFoundationLevel'),
                atMax: isAtEffectiveMax('sturdyFoundationLevel', stats.sturdyFoundationLevel, stats.maxBuildingLevel),
                canBuy: can('sturdyFoundationLevel', stats.sturdyFoundationLevel),
                lockReason: lockReasonFor('sturdyFoundationLevel', stats.sturdyFoundationLevel),
                onBuy: () =>
                  room.send('levelUpSturdyFoundation', { ts: Date.now() }),
              })}
              {skillRow({
                ...UPGRADE_INFO.plumbLine,
                level: stats.plumbLineLevel,
                nowLevel: stats.plumbLineLevel,
                nextLevel: stats.plumbLineLevel + 1,
                sub: `Personal. Your bricks straighten +${plumbLinePersonalBonus(stats.plumbLineLevel).toFixed(1)}°.`,
                cost: levelUpCost(stats.plumbLineLevel, 'plumbLineLevel'),
                atMax: isAtEffectiveMax('plumbLineLevel', stats.plumbLineLevel, stats.maxBuildingLevel),
                canBuy: can('plumbLineLevel', stats.plumbLineLevel),
                lockReason: lockReasonFor('plumbLineLevel', stats.plumbLineLevel),
                onBuy: () => room.send('levelUpPlumbLine', { ts: Date.now() }),
              })}
              {skillRow({
                ...UPGRADE_INFO.plumbTeacher,
                level: stats.plumbTeacherLevel,
                nowLevel: getEffectivePlumbTeacherLevel(),
                nextLevel: stats.nextEffectivePlumbTeacherLevel,
                sub: `World-wide. Eff ${getEffectivePlumbTeacherLevel().toFixed(2)}, +${plumbLineTeacherBonus(getEffectivePlumbTeacherLevel()).toFixed(1)}° to all bricks.`,
                cost: levelUpCost(stats.plumbTeacherLevel, 'plumbTeacherLevel'),
                atMax: isAtEffectiveMax('plumbTeacherLevel', stats.plumbTeacherLevel, stats.maxBuildingLevel),
                canBuy: can('plumbTeacherLevel', stats.plumbTeacherLevel),
                lockReason: lockReasonFor('plumbTeacherLevel', stats.plumbTeacherLevel),
                onBuy: () =>
                  room.send('levelUpPlumbTeacher', { ts: Date.now() }),
              })}
              {skillRow({
                ...UPGRADE_INFO.generous,
                level: stats.generousLevel,
                nowLevel: stats.generousLevel,
                nextLevel: stats.generousLevel + 1,
                sub: `Personal. Your bricks worth +${(contributionPersonalBonus(stats.generousLevel) * 100).toFixed(0)}%.`,
                cost: levelUpCost(stats.generousLevel, 'generousLevel'),
                atMax: isAtEffectiveMax('generousLevel', stats.generousLevel, stats.maxBuildingLevel),
                canBuy: can('generousLevel', stats.generousLevel),
                lockReason: lockReasonFor('generousLevel', stats.generousLevel),
                onBuy: () => room.send('levelUpGenerous', { ts: Date.now() }),
              })}
              {skillRow({
                ...UPGRADE_INFO.generousTeacher,
                level: stats.generousTeacherLevel,
                nowLevel: getEffectiveGenerousTeacherLevel(),
                nextLevel: stats.nextEffectiveGenerousTeacherLevel,
                sub: `World-wide. Eff ${getEffectiveGenerousTeacherLevel().toFixed(2)}, +${(contributionTeacherBonus(getEffectiveGenerousTeacherLevel()) * 100).toFixed(0)}% to all bricks.`,
                cost: levelUpCost(stats.generousTeacherLevel, 'generousTeacherLevel'),
                atMax: isAtEffectiveMax('generousTeacherLevel', stats.generousTeacherLevel, stats.maxBuildingLevel),
                canBuy: can('generousTeacherLevel', stats.generousTeacherLevel),
                lockReason: lockReasonFor('generousTeacherLevel', stats.generousTeacherLevel),
                onBuy: () =>
                  room.send('levelUpGenerousTeacher', { ts: Date.now() }),
              })}
              {skillRow({
                ...UPGRADE_INFO.stockpile,
                level: stats.stockpileLevel,
                nowLevel: getEffectiveStockpileLevel(),
                nextLevel: stats.nextEffectiveStockpileLevel,
                sub: `World-wide. Eff ${getEffectiveStockpileLevel().toFixed(2)}, brick cap × ${brickCapMultiplier(getEffectiveStockpileLevel()).toFixed(2)}.`,
                cost: levelUpCost(stats.stockpileLevel, 'stockpileLevel'),
                atMax: isAtEffectiveMax('stockpileLevel', stats.stockpileLevel, stats.maxBuildingLevel),
                canBuy: can('stockpileLevel', stats.stockpileLevel),
                lockReason: lockReasonFor('stockpileLevel', stats.stockpileLevel),
                onBuy: () => room.send('levelUpStockpile', { ts: Date.now() }),
              })}
              {skillRow({
                ...UPGRADE_INFO.tithe,
                level: stats.titheLevel,
                nowLevel: stats.titheLevel,
                nextLevel: stats.titheLevel + 1,
                sub: `Personal. +${(titheBonus(stats.titheLevel) * 100).toFixed(0)}% upgrade currency on every brick you collect.`,
                cost: levelUpCost(stats.titheLevel, 'titheLevel'),
                atMax: isAtEffectiveMax('titheLevel', stats.titheLevel, stats.maxBuildingLevel),
                canBuy: can('titheLevel', stats.titheLevel),
                lockReason: lockReasonFor('titheLevel', stats.titheLevel),
                onBuy: () => room.send('levelUpTithe', { ts: Date.now() }),
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
  description: string
  formatEffect: (level: number) => string
  level: number
  // Inputs to formatEffect for the button tooltip. For personal skills these
  // are level / level+1; for global skills they're the world-effective now
  // and the world-effective if THIS player levels up by 1 (server-computed).
  nowLevel: number
  nextLevel: number
  sub: string
  cost: number
  atMax: boolean
  canBuy: boolean
  // When set, the upgrade is gated by a building level; replaces the button
  // label with "Beat <Building> Lv N" instead of "MAX" / cost text.
  lockReason?: string
  onBuy: () => void
}) {
  const tooltip = `${opts.title}\n\n${opts.description}`
  const displayTitle = `${opts.title}  L${opts.level}`
  const buttonTooltip = opts.atMax
    ? `${opts.title}\n\nNow:  ${opts.formatEffect(opts.nowLevel)}\nMAX level reached.`
    : `${opts.title}\n\nNow:    ${opts.formatEffect(opts.nowLevel)}\nNext:  ${opts.formatEffect(opts.nextLevel)}`
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
      onMouseEnter={() => {
        hoveredTooltip = tooltip
      }}
      onMouseLeave={() => {
        if (hoveredTooltip === tooltip) hoveredTooltip = null
      }}
    >
      <UiEntity
        uiTransform={{
          width: 260,
          flexDirection: 'column',
        }}
      >
        <Label
          value={displayTitle}
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
      <UiEntity
        uiTransform={{ width: 150, height: 28 }}
        onMouseEnter={() => {
          hoveredTooltip = buttonTooltip
        }}
        onMouseLeave={() => {
          // Mouse leaves button but is still inside the row → restore row tooltip
          hoveredTooltip = tooltip
        }}
      >
        {roundedButton({
          value: opts.lockReason
            ? opts.lockReason
            : opts.atMax
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
