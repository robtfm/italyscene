import {
  engine,
  PlayerIdentityData,
  PrimaryPointerInfo,
  RealmInfo,
  Transform,
} from '@dcl/sdk/ecs'
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
  maxLevelFor,
  maxBrickStack,
  pickupRadius,
  plumbLinePersonalBonus,
  plumbLineTeacherBonus,
  spawnIntervalScale,
  sturdyAngleBonus,
  titheBonus,
} from '../shared/upgrades'
import {
  BUILDING_CONFIGS,
  COMPLETION_CELEBRATION_S,
  brickStraightenFor,
} from '../shared/buildings'
import { clearPopup, getPopup } from './popup-state'
import { getLeaderboardSnapshot } from './leaderboard-state'
import { playGlobal } from './audio'
import { flipPointerY } from './renderer'

const piazzaRed = Color4.fromHexString('#c8233bff')
const panelGreen = Color4.create(0.06, 0.34, 0.18, 0.92)
const panelCream = Color4.create(0.96, 0.95, 0.92, 0.96)
const panelBlack = Color4.create(0, 0, 0, 0.55)
const black = Color4.Black()
// Warm parchment tone sampled from the upgrade icons.
const parchment = Color4.fromHexString('#e0d0a0ff')

let skillTreeOpen = false
let statsOpen = false
let leaderboardOpen = false
type LBKind = 'total' | 'building' | 'bricks' | 'skill'
let leaderboardKind: LBKind = 'total'
// Default sub-selections for the building / skill kinds.
let leaderboardSubBuilding = 'TowerOfPisa'
let leaderboardSubSkill = 'multiBricksLevel'
// Renaissance allocation modal — when open, holds the player's draft of
// perk allocations they're about to commit. Initialised from their current
// perkPoints when the modal opens.
let renaissanceOpen = false
let renaissanceDraft: Record<string, number> = {}
let hoveredTooltip: string | null = null
// Optional icon to show enlarged inside the tooltip — set in parallel with
// hoveredTooltip when hovering an upgrade icon, cleared on mouse leave.
let hoveredIcon: string | null = null
// Extra left offset for the tooltip (pixels). Set when hovering elements
// pinned to the right edge so the tooltip clears the panel they live in.
let hoveredTooltipExtraLeft = 0
// When true, the tooltip extends to the RIGHT of the cursor instead of
// the left. Set on hover of elements pinned to the left side (skill-tree
// level-up buttons sit on the right of the modal but display text best
// to the right of the cursor since the modal is centered).
let hoveredTooltipAnchorRight = false
let hoveredCardIndex = 0

// Closing a modal (backdrop click, Close button, etc.) yanks the hover
// targets out from under the cursor before onMouseLeave fires, so the
// tooltip stays stuck. Call this from every modal-close path.
function clearHoverTooltip() {
  hoveredTooltip = null
  hoveredIcon = null
  hoveredTooltipExtraLeft = 0
  hoveredTooltipAnchorRight = false
}

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

// Cost-for-next-level given a perk-aware "total level". Perks are free
// starting levels, so cost progression is based on purchases only.
function nextCost(
  totalLevel: number,
  perkPoints: Record<string, number>,
  key: string
): number {
  return levelUpCost(Math.max(0, totalLevel - (perkPoints[key] ?? 0)), key)
}

function currentlyBuyable(): Set<string> {
  const stats = getMyStats()
  const available = stats.lifetimeContributions - stats.bricksSpent
  const out = new Set<string>()
  for (const u of ALL_UPGRADES) {
    const lvl = u.getter(stats)
    if (isAtEffectiveMax(u.key, lvl, stats.maxBuildingLevel)) continue
    if (available >= nextCost(lvl, stats.perkPoints, u.key))
      out.add(buyableKey(u.key, lvl + 1))
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

// Same acknowledgement pattern for the prestige benefit. Each (building,
// currentMax) where currentMax > prestigedMax is a key; opening the
// character modal adds those keys to the ack set, so the next time a player
// beats a building at a higher level a fresh key pops the highlight again.
const acknowledgedPrestige = new Set<string>()

function pendingPrestigeBenefits(): Set<string> {
  const stats = getMyStats()
  const out = new Set<string>()
  for (const k of Object.keys(stats.maxBuildingLevel)) {
    const cur = stats.maxBuildingLevel[k] ?? 0
    const snap = stats.prestigedMaxBuildingLevel[k] ?? 0
    if (cur > snap) out.add(`${k}:${cur}`)
  }
  return out
}

function hasUnacknowledgedPrestigeBenefit(): boolean {
  for (const k of pendingPrestigeBenefits()) {
    if (!acknowledgedPrestige.has(k)) return true
  }
  return false
}

function acknowledgePrestigeBenefits() {
  for (const k of pendingPrestigeBenefits()) acknowledgedPrestige.add(k)
}

function isPreviewRealm(): boolean {
  return RealmInfo.getOrNull(engine.RootEntity)?.isPreview ?? false
}

function currentLeaderboardCategory(): string {
  switch (leaderboardKind) {
    case 'total':
      return 'total'
    case 'bricks':
      return 'bricks'
    case 'building':
      return `building:${leaderboardSubBuilding}`
    case 'skill':
      return `skill:${leaderboardSubSkill}`
  }
}

function requestLeaderboard(category: string) {
  room.send('leaderboardRequest', { category, ts: Date.now() })
}

function openLeaderboard() {
  leaderboardOpen = true
  requestLeaderboard(currentLeaderboardCategory())
}

function selectLeaderboardKind(kind: LBKind) {
  leaderboardKind = kind
  requestLeaderboard(currentLeaderboardCategory())
}

function selectLeaderboardSubBuilding(entityName: string) {
  leaderboardSubBuilding = entityName
  requestLeaderboard(`building:${entityName}`)
}

function selectLeaderboardSubSkill(levelKey: string) {
  leaderboardSubSkill = levelKey
  requestLeaderboard(`skill:${levelKey}`)
}

function truncatedAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}


// Auto-fire while the DEBUG brick button is held. setupUi installs a system
// that sends one debugAddBrick every DEBUG_HOLD_INTERVAL_MS while held.
let debugAddBrickHeld = false
let debugAddBrickTimer = 0
const DEBUG_HOLD_INTERVAL_MS = 100

function debugBrickHoldSystem(dt: number) {
  if (!debugAddBrickHeld) {
    debugAddBrickTimer = 0
    return
  }
  debugAddBrickTimer += dt * 1000
  while (debugAddBrickTimer >= DEBUG_HOLD_INTERVAL_MS) {
    debugAddBrickTimer -= DEBUG_HOLD_INTERVAL_MS
    room.send('debugAddBrick', { ts: Date.now() })
  }
}

const CARD_TOP = 110
const CARD_STRIDE = 110
const CARD_WIDTH = 170
const CARD_RIGHT_MARGIN = 12

const PANEL_OUTER_RADIUS = 12
const PANEL_INNER_RADIUS = 8

// Shared "green-frame around cream interior" panel used by every UI surface.
// `transparent: true` skips both colors — useful for the right-edge cards
// where we want the icons/values floating without a backdrop.
type PanelProps = {
  width?: any
  padding?: any
  margin?: any
  transparent?: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  children?: any
}
function framedPanel(p: PanelProps) {
  const padding = p.padding ?? 6
  const transparent = Color4.create(0, 0, 0, 0)
  return (
    <UiEntity
      uiTransform={{
        width: p.width,
        padding: 4,
        margin: p.margin,
        borderRadius: PANEL_OUTER_RADIUS,
      }}
      uiBackground={{ color: p.transparent ? transparent : panelGreen }}
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
        uiBackground={{ color: p.transparent ? transparent : panelCream }}
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
  onMouseUp?: () => void
  onMouseLeave?: () => void
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
      onMouseUp={p.onMouseUp}
      onMouseLeave={p.onMouseLeave}
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

// Hover state for image-based buttons (skill-tree icon, stats icon, etc.).
// Module-level so onMouseLeave on one button can safely no-op when the hover
// has already moved to a sibling — see the ownership pattern used by the
// powerup-card tooltips.
let hoveredImageButton: string | null = null

function imageButton(opts: {
  // Stable id; keep hover state from sticking on a sibling.
  key: string
  src: string
  width: number
  height: number
  label?: string
  // Highlight even without hover — used for "you have new upgrades" pulse.
  popping?: boolean
  onMouseDown?: () => void
  margin?: any
}) {
  const hovered = hoveredImageButton === opts.key
  const active = hovered || !!opts.popping
  // Halo cycles parchment ↔ popHot at ~1 Hz when active; transparent otherwise.
  const cycle = (Math.sin((Date.now() / 1000) * Math.PI * 2) + 1) / 2
  const haloColor = active
    ? lerpColor(parchment, popHot, cycle)
    : Color4.create(0, 0, 0, 0)
  const FRAME = 6
  const LABEL_HEIGHT = opts.label ? 20 : 0
  // Outer column: halo wraps only the image; label sits below it so the
  // cycling halo color doesn't clash with the text.
  return (
    <UiEntity
      uiTransform={{
        width: opts.width + FRAME * 2,
        height: opts.height + FRAME * 2 + LABEL_HEIGHT,
        margin: opts.margin,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
      }}
      onMouseEnter={() => {
        hoveredImageButton = opts.key
      }}
      onMouseLeave={() => {
        if (hoveredImageButton === opts.key) hoveredImageButton = null
      }}
      onMouseDown={() => {
        playGlobal('uiClick')
        opts.onMouseDown?.()
      }}
    >
      <UiEntity
        uiTransform={{
          width: opts.width + FRAME * 2,
          height: opts.height + FRAME * 2,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 14,
        }}
        uiBackground={{ color: haloColor }}
      >
        <UiEntity
          uiTransform={{ width: opts.width, height: opts.height }}
          uiBackground={{
            texture: { src: opts.src },
            textureMode: 'stretch',
          }}
        />
      </UiEntity>
      {opts.label ? (
        <Label
          value={opts.label}
          fontSize={14}
          color={Color4.White()}
          uiTransform={{ width: '100%', height: LABEL_HEIGHT }}
          textAlign="middle-center"
        />
      ) : null}
    </UiEntity>
  )
}

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(uiComponent)
  engine.addSystem(debugBrickHoldSystem)
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
    {statsOpen ? statsModal() : null}
    {renaissanceOpen ? renaissanceModal() : null}
    {leaderboardOpen ? leaderboardModal() : null}
    {getPopup() ? popupToast() : null}
  </UiEntity>
)

function popupToast() {
  const popup = getPopup()
  if (!popup) return null
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
      }}
      uiBackground={{ color: panelBlack }}
      onMouseDown={() => {
        clearPopup()
      }}
    >
      {framedPanel({
        width: 520,
        padding: 20,
        children: (
          <UiEntity
            uiTransform={{
              width: '100%',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            {popup.imageSrc ? (
              <UiEntity
                uiTransform={{
                  width: 300,
                  height: 180,
                  margin: '0 0 8px 0',
                }}
                uiBackground={{
                  texture: { src: popup.imageSrc },
                  textureMode: 'stretch',
                }}
              />
            ) : null}
            <Label
              value={popup.title}
              fontSize={20}
              color={black}
              uiTransform={{ width: '100%', height: 30 }}
              textAlign="middle-center"
            />
            {popup.body.map((line) => (
              <Label
                value={line}
                fontSize={13}
                color={black}
                // height: 'auto' so the Label grows with wrapped lines using
                // the renderer's own line-spacing; paragraph gap is the
                // outer margin so within-line spacing and between-paragraph
                // spacing read consistently.
                uiTransform={{
                  width: '100%',
                  height: 'auto',
                  margin: '10px 0 0 0',
                }}
                textAlign="middle-center"
              />
            ))}
            <Label
              value="Click anywhere to dismiss"
              fontSize={11}
              color={Color4.create(0, 0, 0, 0.6)}
              uiTransform={{ width: '100%', height: 18, margin: '12px 0 0 0' }}
              textAlign="middle-center"
            />
          </UiEntity>
        ),
      })}
    </UiEntity>
  )
}

// Each upgrade keyed by its level field + the matching UPGRADE_INFO entry
// (used for display titles in the Renaissance perk allocation modal).
const PERK_ROWS: Array<{ levelKey: string; infoKey: string }> = [
  { levelKey: 'multiBricksLevel', infoKey: 'multiBricks' },
  { levelKey: 'pickupRadiusLevel', infoKey: 'pickupRadius' },
  { levelKey: 'fasterSpawnsLevel', infoKey: 'fasterSpawns' },
  { levelKey: 'leanDampenerLevel', infoKey: 'leanDampener' },
  { levelKey: 'sturdyFoundationLevel', infoKey: 'sturdyFoundation' },
  { levelKey: 'plumbLineLevel', infoKey: 'plumbLine' },
  { levelKey: 'plumbTeacherLevel', infoKey: 'plumbTeacher' },
  { levelKey: 'generousLevel', infoKey: 'generous' },
  { levelKey: 'generousTeacherLevel', infoKey: 'generousTeacher' },
  { levelKey: 'stockpileLevel', infoKey: 'stockpile' },
  { levelKey: 'titheLevel', infoKey: 'tithe' },
]

function perkPoolFor(maxBuildingLevel: Record<string, number>): number {
  let sum = 0
  for (const v of Object.values(maxBuildingLevel)) sum += v
  return Math.floor(sum / 3)
}

function renaissanceModal() {
  const stats = getMyStats()
  const pool = perkPoolFor(stats.maxBuildingLevel)
  let allocated = 0
  for (const v of Object.values(renaissanceDraft)) allocated += v
  const remaining = pool - allocated
  const canConfirm = allocated <= pool
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 150,
      }}
    >
      {/* Backdrop as a SIBLING of the panel, not a parent: Unity bubbles
          child clicks to ancestors, so pointerFilter on the panel alone
          doesn't stop close-on-backdrop. */}
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 0, left: 0 },
          width: '100%',
          height: '100%',
        }}
        uiBackground={{ color: panelBlack }}
        onMouseDown={() => {
          renaissanceOpen = false
          clearHoverTooltip()
        }}
      />
      <UiEntity
        uiTransform={{ width: 520, pointerFilter: 'block' }}
        onMouseDown={() => {}}
      >
        {framedPanel({
          width: '100%',
          padding: 12,
          children: (
            <UiEntity
              uiTransform={{ width: '100%', flexDirection: 'column' }}
            >
              <Label
                value="Renaissance — allocate permanent perks"
                fontSize={16}
                color={black}
                uiTransform={{ width: '100%', height: 24 }}
                textAlign="middle-center"
              />
              <Label
                value={`Pool: ${pool}   ·   Allocated: ${allocated} / ${pool}`}
                fontSize={12}
                color={allocated > pool ? piazzaRed : black}
                uiTransform={{ width: '100%', height: 20, margin: '4px 0 8px 0' }}
                textAlign="middle-center"
              />
              {PERK_ROWS.map((row) => {
                const info = UPGRADE_INFO[row.infoKey]
                return perkAllocRow({
                  levelKey: row.levelKey,
                  title: info.title,
                  description: info.description,
                  iconPath: info.iconPath,
                  current: renaissanceDraft[row.levelKey] ?? 0,
                  remaining,
                  cap: maxLevelFor(row.levelKey),
                })
              })}
              <UiEntity
                uiTransform={{
                  width: '100%',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  margin: '14px 0 0 0',
                }}
              >
                {roundedButton({
                  value: 'Cancel',
                  variant: 'secondary',
                  width: 120,
                  height: 30,
                  onMouseDown: () => {
                    playGlobal('uiClick')
                    renaissanceOpen = false
                    clearHoverTooltip()
                  },
                })}
                {roundedButton({
                  value: 'Begin Renaissance',
                  variant: canConfirm ? 'primary' : 'secondary',
                  width: 220,
                  height: 30,
                  onMouseDown: () => {
                    if (!canConfirm) return
                    playGlobal('uiClick')
                    room.send('prestige', {
                      ts: Date.now(),
                      allocationJson: JSON.stringify(renaissanceDraft),
                    })
                    renaissanceOpen = false
                    statsOpen = false
                    clearHoverTooltip()
                  },
                })}
              </UiEntity>
              <Label
                value="Resets bricks, upgrades, and unlocked buildings. Snapshots building maxes (income × 2^max per brick). Perks become free starting upgrade levels next run."
                fontSize={10}
                color={Color4.create(0, 0, 0, 0.65)}
                uiTransform={{ width: '100%', height: 30, margin: '8px 0 0 0' }}
                textAlign="middle-center"
              />
            </UiEntity>
          ),
        })}
      </UiEntity>
    </UiEntity>
  )
}

function perkAllocRow(opts: {
  levelKey: string
  title: string
  description: string
  iconPath?: string
  current: number
  remaining: number
  cap: number
}) {
  const atCap = opts.current >= opts.cap
  const canDec = opts.current > 0
  const canInc = !atCap && opts.remaining > 0
  const tooltip = `${opts.title}\n\n${opts.description}`
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        height: 26,
        margin: '2px 0',
      }}
      onMouseEnter={() => {
        hoveredTooltip = tooltip
        hoveredIcon = opts.iconPath ?? null
        hoveredTooltipAnchorRight = true
      }}
      onMouseLeave={() => {
        if (hoveredTooltip === tooltip) {
          hoveredTooltip = null
          hoveredIcon = null
          hoveredTooltipAnchorRight = false
        }
      }}
    >
      <Label
        value={opts.title}
        fontSize={12}
        color={black}
        uiTransform={{ width: '60%', height: 22 }}
      />
      {roundedButton({
        value: '−',
        variant: canDec ? 'primary' : 'secondary',
        width: 32,
        height: 22,
        fontSize: 14,
        margin: '0 4px',
        onMouseDown: () => {
          if (!canDec) return
          playGlobal('uiClick')
          renaissanceDraft[opts.levelKey] = opts.current - 1
        },
      })}
      <Label
        value={`+${opts.current}`}
        fontSize={13}
        color={opts.current > 0 ? piazzaRed : black}
        uiTransform={{ width: 50, height: 22 }}
        textAlign="middle-center"
      />
      {roundedButton({
        value: '+',
        variant: canInc ? 'primary' : 'secondary',
        width: 32,
        height: 22,
        fontSize: 14,
        margin: '0 4px',
        onMouseDown: () => {
          if (!canInc) return
          playGlobal('uiClick')
          renaissanceDraft[opts.levelKey] = opts.current + 1
        },
      })}
    </UiEntity>
  )
}

// Same level-keys list used elsewhere, just the order in which the skill
// leaderboard tabs appear.
const LB_SKILL_KEYS: string[] = [
  'multiBricksLevel',
  'pickupRadiusLevel',
  'fasterSpawnsLevel',
  'leanDampenerLevel',
  'sturdyFoundationLevel',
  'plumbLineLevel',
  'plumbTeacherLevel',
  'generousLevel',
  'generousTeacherLevel',
  'stockpileLevel',
  'titheLevel',
]
const LB_SKILL_INFO_KEY: Record<string, string> = {
  multiBricksLevel: 'multiBricks',
  pickupRadiusLevel: 'pickupRadius',
  fasterSpawnsLevel: 'fasterSpawns',
  leanDampenerLevel: 'leanDampener',
  sturdyFoundationLevel: 'sturdyFoundation',
  plumbLineLevel: 'plumbLine',
  plumbTeacherLevel: 'plumbTeacher',
  generousLevel: 'generous',
  generousTeacherLevel: 'generousTeacher',
  stockpileLevel: 'stockpile',
  titheLevel: 'tithe',
}

function leaderboardTitle(): string {
  switch (leaderboardKind) {
    case 'total':
      return 'Builder ranks (sum of building levels)'
    case 'bricks':
      return 'All-time bricks contributed'
    case 'building': {
      const cfg = BUILDING_CONFIGS.find(
        (c) => c.entityName === leaderboardSubBuilding
      )
      return `${cfg?.displayName ?? leaderboardSubBuilding} — best builder level`
    }
    case 'skill': {
      const infoKey = LB_SKILL_INFO_KEY[leaderboardSubSkill]
      const info = infoKey ? UPGRADE_INFO[infoKey] : undefined
      return `${info?.title ?? leaderboardSubSkill} — peak skill level`
    }
  }
}

function leaderboardModal() {
  const myAddress =
    PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address?.toLowerCase() ??
    ''
  const category = currentLeaderboardCategory()
  const snap = getLeaderboardSnapshot(category)
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 120,
      }}
    >
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 0, left: 0 },
          width: '100%',
          height: '100%',
        }}
        uiBackground={{ color: panelBlack }}
        onMouseDown={() => {
          leaderboardOpen = false
          clearHoverTooltip()
        }}
      />
      <UiEntity
        uiTransform={{ width: 560, pointerFilter: 'block' }}
        onMouseDown={() => {}}
      >
        {framedPanel({
          width: '100%',
          padding: 12,
          children: (
            <UiEntity
              uiTransform={{ width: '100%', flexDirection: 'column' }}
            >
              <Label
                value="Leaderboards"
                fontSize={18}
                color={black}
                uiTransform={{ width: '100%', height: 26 }}
                textAlign="middle-center"
              />
              {/* Top tabs */}
              <UiEntity
                uiTransform={{
                  width: '100%',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  margin: '6px 0 0 0',
                }}
              >
                {leaderboardTabButton('Total', 'total')}
                {leaderboardTabButton('Building', 'building')}
                {leaderboardTabButton('Bricks', 'bricks')}
                {leaderboardTabButton('Skill', 'skill')}
              </UiEntity>
              {/* Sub-picker (only populated for building / skill; the
                  wrapper has a fixed height in every case so the modal
                  doesn't resize when switching tabs.) */}
              <UiEntity
                uiTransform={{
                  width: '100%',
                  height: 120,
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  alignContent: 'flex-start',
                  margin: '6px 0 0 0',
                }}
              >
                {leaderboardKind === 'building'
                  ? BUILDING_CONFIGS.map((cfg) =>
                      leaderboardSubButton(
                        cfg.displayName,
                        cfg.entityName === leaderboardSubBuilding,
                        () => selectLeaderboardSubBuilding(cfg.entityName)
                      )
                    )
                  : leaderboardKind === 'skill'
                  ? LB_SKILL_KEYS.map((key) => {
                      const infoKey = LB_SKILL_INFO_KEY[key]
                      const title = infoKey
                        ? UPGRADE_INFO[infoKey].title
                        : key
                      return leaderboardSubButton(
                        title,
                        key === leaderboardSubSkill,
                        () => selectLeaderboardSubSkill(key)
                      )
                    })
                  : null}
              </UiEntity>
              {/* Title */}
              <Label
                value={leaderboardTitle()}
                fontSize={12}
                color={Color4.create(0, 0, 0, 0.7)}
                uiTransform={{ width: '100%', height: 20, margin: '8px 0 4px 0' }}
                textAlign="middle-center"
              />
              {/* Body */}
              {leaderboardBody(snap, myAddress)}
              {/* Close */}
              <UiEntity
                uiTransform={{
                  width: '100%',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  margin: '12px 0 0 0',
                }}
              >
                {roundedButton({
                  value: 'Close',
                  variant: 'secondary',
                  width: 120,
                  height: 28,
                  onMouseDown: () => {
                    playGlobal('uiClick')
                    leaderboardOpen = false
                    clearHoverTooltip()
                  },
                })}
              </UiEntity>
            </UiEntity>
          ),
        })}
      </UiEntity>
    </UiEntity>
  )
}

function leaderboardTabButton(label: string, kind: LBKind) {
  const active = leaderboardKind === kind
  return roundedButton({
    value: label,
    variant: active ? 'primary' : 'secondary',
    width: 120,
    height: 26,
    fontSize: 12,
    onMouseDown: () => selectLeaderboardKind(kind),
  })
}

function leaderboardSubButton(
  label: string,
  active: boolean,
  onMouseDown: () => void
) {
  return roundedButton({
    value: label,
    variant: active ? 'primary' : 'secondary',
    width: 130,
    height: 22,
    margin: '2px 3px',
    fontSize: 11,
    onMouseDown,
  })
}

// Fixed body height — accommodates 10 top-row entries + the optional
// inline "you" row + separator without resizing the panel as the snapshot
// loads in.
const LB_BODY_HEIGHT = 460

function leaderboardBody(
  snap: ReturnType<typeof getLeaderboardSnapshot>,
  myAddress: string
) {
  if (!snap) {
    return (
      <UiEntity
        uiTransform={{
          width: '100%',
          height: LB_BODY_HEIGHT,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Label
          value="Loading…"
          fontSize={12}
          color={Color4.create(0, 0, 0, 0.7)}
          uiTransform={{ width: '100%', height: 40 }}
          textAlign="middle-center"
        />
      </UiEntity>
    )
  }
  const rows: any[] = []
  for (let i = 0; i < snap.entries.length; i++) {
    const e = snap.entries[i]
    rows.push(
      leaderboardRow({
        rank: i + 1,
        address: e.address,
        name: e.name,
        avatarUrl: e.avatarUrl,
        score: e.score,
        you: e.address.toLowerCase() === myAddress,
      })
    )
  }
  // If the caller isn't in the top 10, append a separator + their row.
  if (snap.myRank < 0 && myAddress) {
    rows.push(
      <Label
        key="lb-sep"
        value="…"
        fontSize={14}
        color={Color4.create(0, 0, 0, 0.5)}
        uiTransform={{ width: '100%', height: 18, margin: '4px 0 0 0' }}
        textAlign="middle-center"
      />
    )
    rows.push(
      leaderboardRow({
        rank: 0,
        address: myAddress,
        name: snap.myName,
        avatarUrl: snap.myAvatarUrl,
        score: snap.myScore,
        you: true,
      })
    )
  }
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: LB_BODY_HEIGHT,
        flexDirection: 'column',
      }}
    >
      {rows}
    </UiEntity>
  )
}

function leaderboardRow(opts: {
  rank: number
  address: string
  name?: string
  avatarUrl?: string
  score: number
  you: boolean
}) {
  const rankText = opts.rank > 0 ? `${opts.rank}.` : '—'
  const display = opts.name && opts.name.length > 0
    ? opts.name
    : truncatedAddress(opts.address)
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        padding: 4,
        margin: '2px 0',
        borderRadius: 4,
        height: 36,
      }}
      uiBackground={{
        color: opts.you
          ? Color4.create(0.8, 0.2, 0.2, 0.18)
          : Color4.create(0, 0, 0, 0.05),
      }}
    >
      <Label
        value={rankText}
        fontSize={13}
        color={opts.you ? piazzaRed : black}
        uiTransform={{ width: '10%', height: 28 }}
        textAlign="middle-center"
      />
      <UiEntity
        uiTransform={{
          width: 28,
          height: 28,
          margin: '0 6px 0 0',
          borderRadius: 14,
        }}
        uiBackground={
          opts.avatarUrl && opts.avatarUrl.length > 0
            ? {
                texture: { src: opts.avatarUrl },
                textureMode: 'stretch',
              }
            : { color: Color4.create(0, 0, 0, 0.15) }
        }
      />
      <Label
        value={display}
        fontSize={13}
        color={opts.you ? piazzaRed : black}
        uiTransform={{ width: '55%', height: 28 }}
      />
      <Label
        value={Math.floor(opts.score).toLocaleString()}
        fontSize={13}
        color={opts.you ? piazzaRed : black}
        uiTransform={{ width: '25%', height: 28 }}
        textAlign="middle-right"
      />
    </UiEntity>
  )
}

function topCenter() {
  const active = getActiveBuildingState()
  // level is 0-indexed in state; display 1-indexed (Lv 1 = fresh start).

  function leanFraction(
    a: NonNullable<ReturnType<typeof getActiveBuildingState>>
  ): number {
    const threshold = a.collapseAngleDeg + sturdyAngleBonus(getEffectiveSturdyFoundationLevel())
    return threshold > 0 ? a.displayLean / threshold : 0
  }
  function leanDescription(
    a: ReturnType<typeof getActiveBuildingState>
  ): string {
    if (!a) return '—'
    if (a.collapsing) return 'collapsing!'
    const f = leanFraction(a)
    if (f < 0.15) return 'stable'
    if (f < 0.35) return 'settling'
    if (f < 0.6) return 'unsteady'
    if (f < 0.85) return 'precarious'
    return 'dangerous'
  }
  function leanColor(a: ReturnType<typeof getActiveBuildingState>): Color4 {
    if (!a) return black
    const f = leanFraction(a)
    if (f < 0.6) return black
    if (f < 0.85) return Color4.fromHexString('#a85a18ff')
    return piazzaRed
  }

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
      {(() => {
        const bricksCollected = getBrickCount()
        const remaining = active
          ? Math.max(0, Math.ceil(active.bricksRequired - bricksCollected))
          : 0
        const pct = active ? Math.round(active.riseProgress * 100) : 0
        const stateLabel: string | null =
          active === null
            ? null
            : active.collapsing
            ? 'COLLAPSING!!!'
            : active.completedTime > 0
            ? `COMPLETE — next in ${Math.max(
                0,
                COMPLETION_CELEBRATION_S - active.completedTime
              ).toFixed(1)}s`
            : null
        const stateColor =
          active?.collapsing || (active && active.completedTime > 0)
            ? piazzaRed
            : black
        const activeCfg = active
          ? BUILDING_CONFIGS.find((c) => c.displayName === active.displayName) ??
            null
          : null
        const statsTooltip = (() => {
          if (!activeCfg || !active) return null
          const heightSpan = 0.55 - activeCfg.riseStartLeanProgress
          const heightScale = Math.max(
            0,
            (active.riseProgress - activeCfg.riseStartLeanProgress) / heightSpan
          )
          const dampenScale = leanRateScale(getEffectiveLeanDampenerLevel())
          const currentLeanPerSec =
            activeCfg.leanRatePerSec * heightScale * dampenScale
          const stats = getMyStats()
          const tithe = titheBonus(stats.titheLevel)
          const prestigeMult = Math.pow(
            2,
            stats.prestigedMaxBuildingLevel[activeCfg.entityName] ?? 0
          )
          const earnMult = (1 + tithe) * prestigeMult
          return [
            `Lean rate: ${currentLeanPerSec.toFixed(2)}°/s (grows with height)`,
            `Per-brick straighten: ${brickStraightenFor(
              activeCfg,
              active.level
            ).toFixed(2)}° (before bonuses)`,
            `Collapse threshold: ${activeCfg.collapseAngleDeg}°`,
            `You earn ×${earnMult.toFixed(2)} per brick (tithe + prestige)`,
          ].join('\n')
        })()
        return (
          <UiEntity
            // Outer wrapper carries the book background at full size with NO
            // padding. Unity and Bevy disagree on whether padding shrinks the
            // background area, so we keep padding on the inner wrapper only.
            uiTransform={{
              width: 460,
              height: 200,
              padding: 0,
              flexDirection: 'column',
            }}
            uiBackground={{
              texture: { src: 'images/blank_book.png' },
              textureMode: 'stretch',
            }}
            onMouseEnter={() => {
              if (!statsTooltip) return
              hoveredTooltip = statsTooltip
              hoveredIcon = null
              // Top panel sits centered up high; cursor is also high so the
              // tooltip's "above the cursor" preference clamps it to top:8
              // anyway. Anchor right keeps it from drifting off-screen on the
              // left edge when the cursor is near the panel's left side.
              hoveredTooltipAnchorRight = true
            }}
            onMouseLeave={() => {
              if (hoveredTooltip === statsTooltip) {
                hoveredTooltip = null
                hoveredTooltipAnchorRight = false
              }
            }}
          >
          <UiEntity
            uiTransform={{
              width: '100%',
              height: '100%',
              padding: 18,
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            {/* Title bar: "Marble" left page, "&" on the spine, "Mortar" right */}
            <UiEntity
              uiTransform={{
                width: '100%',
                flexDirection: 'row',
                alignItems: 'center',
                margin: '0 0 12px 0',
              }}
            >
              <Label
                value="Marble"
                fontSize={40}
                color={black}
                uiTransform={{ width: '45%', height: 52 }}
                textAlign="middle-right"
              />
              <Label
                value="&"
                fontSize={40}
                color={black}
                uiTransform={{ width: '10%', height: 52 }}
                textAlign="middle-center"
              />
              <Label
                value="Mortar"
                fontSize={40}
                color={black}
                uiTransform={{ width: '45%', height: 52 }}
                textAlign="middle-left"
              />
            </UiEntity>
            {/* Body: two pages side by side */}
            <UiEntity
              uiTransform={{
                width: '100%',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                flexGrow: 1,
              }}
            >
            {/* Left page: building name */}
            <UiEntity
              uiTransform={{
                width: '50%',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Label
                value={active?.displayName ?? '…'}
                fontSize={22}
                color={black}
                uiTransform={{ width: '100%', height: 40 }}
                textAlign="middle-center"
              />
              <Label
                value={`Lean: ${leanDescription(active)}`}
                fontSize={15}
                color={leanColor(active)}
                uiTransform={{ width: '100%', height: 22, margin: '4px 0 0 0' }}
                textAlign="middle-center"
              />
            </UiEntity>
            {/* Right page: stats */}
            <UiEntity
              uiTransform={{
                width: '50%',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {stateLabel ? (
                <Label
                  value={stateLabel}
                  fontSize={18}
                  color={stateColor}
                  uiTransform={{ width: '100%', height: 28 }}
                  textAlign="middle-center"
                />
              ) : (
                <UiEntity
                  uiTransform={{
                    width: '100%',
                    flexDirection: 'column',
                    alignItems: 'center',
                  }}
                >
                  <Label
                    value={active ? `Lv ${active.level + 1}` : '—'}
                    fontSize={17}
                    color={black}
                    uiTransform={{ width: '100%', height: 24 }}
                    textAlign="middle-center"
                  />
                  <Label
                    value={active ? `${pct}% complete` : ''}
                    fontSize={15}
                    color={black}
                    uiTransform={{ width: '100%', height: 22 }}
                    textAlign="middle-center"
                  />
                  <Label
                    value={active ? `${remaining} bricks left` : ''}
                    fontSize={15}
                    color={black}
                    uiTransform={{ width: '100%', height: 22 }}
                    textAlign="middle-center"
                  />
                  <Label
                    value={`Your bricks: ${Math.floor(
                      Math.max(0, getMyContribution() - getMyStats().bricksSpent)
                    )}`}
                    fontSize={15}
                    color={black}
                    uiTransform={{ width: '100%', height: 22 }}
                    textAlign="middle-center"
                  />
                </UiEntity>
              )}
            </UiEntity>
            </UiEntity>
            </UiEntity>
          </UiEntity>
        )
      })()}
    </UiEntity>
  )
}

const ICON_PLACEHOLDER = 'images/upgrades/placeholder.png'

type UpgradeInfo = {
  title: string
  description: string
  formatEffect: (level: number) => string
  iconPath: string
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
    iconPath: 'images/upgrades/brick_bonus.png',
  },
  pickupRadius: {
    title: "Builder's Reach",
    description:
      'Click bricks from further away. Personal — only your own level affects your reach.',
    formatEffect: (L) => `${pickupRadius(L).toFixed(1)} m`,
    iconPath: 'images/upgrades/builders_reach.png',
  },
  fasterSpawns: {
    title: 'Supply Lines',
    description:
      'Bricks spawn more often. World-wide; harmonically stacked across active players.',
    formatEffect: (L) => `× ${spawnIntervalScale(L).toFixed(2)}`,
    iconPath: 'images/upgrades/supply_lines.png',
  },
  leanDampener: {
    title: 'Scaffolding',
    description:
      'Buildings lean over more slowly. World-wide; harmonically stacked across active players.',
    formatEffect: (L) => `× ${leanRateScale(L).toFixed(2)}`,
    iconPath: 'images/upgrades/scaffholding.png',
  },
  sturdyFoundation: {
    title: 'Opus Romano',
    description:
      'Buildings tolerate more lean before collapsing. World-wide; harmonically stacked.',
    formatEffect: (L) => `+${sturdyAngleBonus(L).toFixed(1)}°`,
    iconPath: 'images/upgrades/opus_romano.png',
  },
  plumbLine: {
    title: 'Plumb Line',
    description:
      "Each brick YOU collect straightens lean by an extra %, multiplied on top of the building's per-brick straighten. Personal — only your level affects your bricks.",
    formatEffect: (L) => `+${(plumbLinePersonalBonus(L) * 100).toFixed(0)}%`,
    iconPath: 'images/upgrades/plumb_line.png',
  },
  plumbTeacher: {
    title: 'Plumb Maestro',
    description:
      "A small percentage bonus on every brick's straighten, room-wide. World-wide; harmonically stacked.",
    formatEffect: (L) => `+${(plumbLineTeacherBonus(L) * 100).toFixed(0)}%`,
    iconPath: 'images/upgrades/plumb_maestro.png',
  },
  generous: {
    title: 'Artful Contribution',
    description:
      'Each brick YOU collect counts as more toward the building. Personal — only boosts the building, not your currency.',
    formatEffect: (L) =>
      `+${(contributionPersonalBonus(L) * 100).toFixed(0)}%`,
    iconPath: 'images/upgrades/artful_contribution.png',
  },
  generousTeacher: {
    title: 'Artful Maestro',
    description:
      'A small extra value bonus on EVERY brick collection in the room. World-wide; harmonically stacked.',
    formatEffect: (L) =>
      `+${(contributionTeacherBonus(L) * 100).toFixed(0)}%`,
    iconPath: 'images/upgrades/artful_maestro.png',
  },
  stockpile: {
    title: 'Stockpile',
    description:
      'Raises the cap on how many bricks can be on the field at once. World-wide; harmonically stacked across active players.',
    formatEffect: (L) => `× ${brickCapMultiplier(L).toFixed(2)}`,
    iconPath: 'images/upgrades/stockpile.png',
  },
  tithe: {
    title: "Padrone's Cut",
    description:
      "Keep a bigger cut of every brick you collect for upgrade currency. Doesn't help the building — only your spend power.",
    formatEffect: (L) => `+${(titheBonus(L) * 100).toFixed(0)}%`,
    iconPath: 'images/upgrades/padrones_cut.png',
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
        position: { top: 0, right: CARD_RIGHT_MARGIN },
        height: '100%',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <UiEntity
        uiTransform={{
          width: CARD_WIDTH,
          flexDirection: 'column',
          padding: 8,
          borderRadius: PANEL_OUTER_RADIUS,
        }}
        uiBackground={{ color: Color4.create(0, 0, 0, 0.35) }}
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
    </UiEntity>
  )
}

function sectionHeader(text: string) {
  return (
    <Label
      value={text}
      fontSize={18}
      color={Color4.create(1, 1, 1, 0.85)}
      uiTransform={{
        width: '100%',
        height: 26,
        margin: '6px 0 4px 0',
      }}
      textAlign="middle-center"
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
    transparent: true,
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
            flexGrow: 1,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 6px 0 0',
          }}
          onMouseEnter={() => {
            hoveredTooltip = rightHover
            hoveredIcon = opts.iconPath ?? null
            hoveredTooltipExtraLeft = 70
          }}
          onMouseLeave={() => {
            // Only clear if we're still the owner — guards against the
            // adjacent region's onMouseEnter having already taken over.
            if (hoveredTooltip === rightHover) {
              hoveredTooltip = null
              hoveredIcon = null
              hoveredTooltipExtraLeft = 0
            }
          }}
        >
          <Label
            value={opts.valueText}
            fontSize={20}
            color={parchment}
            uiTransform={{ width: '100%', height: 26 }}
            textAlign="middle-center"
          />
        </UiEntity>
        <UiEntity
          uiTransform={{
            width: 44,
            height: 44,
          }}
          uiBackground={{
            texture: { src: opts.iconPath ?? ICON_PLACEHOLDER },
            textureMode: 'stretch',
          }}
          onMouseEnter={() => {
            hoveredTooltip = leftHover
            hoveredIcon = opts.iconPath ?? null
            hoveredTooltipExtraLeft = 140
          }}
          onMouseLeave={() => {
            if (hoveredTooltip === leftHover) {
              hoveredTooltip = null
              hoveredIcon = null
              hoveredTooltipExtraLeft = 0
            }
          }}
        />
      </UiEntity>
    ),
  })
}

function tooltipBox(text: string) {
  const ptr = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  const tooltipWidth = hoveredIcon ? 280 : 280
  const iconSize = hoveredIcon ? 240 : 0
  const tooltipHeightApprox = 80 + iconSize
  // Anchor RIGHT side of tooltip near cursor: tooltip extends to the left
  // and slightly above. Suits right-edge panels where extending rightward
  // would clip off-screen.
  let left = 32
  let top = 32
  if (ptr?.screenCoordinates) {
    left = hoveredTooltipAnchorRight
      ? ptr.screenCoordinates.x + 16
      : Math.max(
          8,
          ptr.screenCoordinates.x -
            tooltipWidth -
            12 -
            hoveredTooltipExtraLeft
        )
    top = Math.max(8, flipPointerY(ptr.screenCoordinates.y) - tooltipHeightApprox - 8)
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
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', alignItems: 'center' }}>
        {hoveredIcon ? (
          <UiEntity
            uiTransform={{
              width: iconSize,
              height: iconSize,
              margin: '0 0 6px 0',
            }}
            uiBackground={{
              texture: { src: hoveredIcon },
              textureMode: 'stretch',
            }}
          />
        ) : null}
        <Label
          value={text}
          fontSize={16}
          color={Color4.White()}
          // Unity treats an unset height as 0 here, so the backdrop only
          // covers the icon. Bevy grows the parent to fit the text. Setting
          // height: 'auto' explicitly gives both renderers the same answer.
          uiTransform={{ width: '100%', height: 'auto' }}
        />
      </UiEntity>
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
      {imageButton({
        key: 'skill-tree',
        src: 'images/skill_tree.png',
        width: 150,
        height: 90,
        label: 'Skill tree',
        margin: '0 4px',
        popping: hasUnacknowledgedBuyable(),
        onMouseDown: () => {
          acknowledgeBuyables()
          skillTreeOpen = true
        },
      })}
      {imageButton({
        key: 'stats',
        src: 'images/prestige.png',
        width: 150,
        height: 90,
        label: 'Character',
        margin: '0 4px',
        popping: hasUnacknowledgedPrestigeBenefit(),
        onMouseDown: () => {
          acknowledgePrestigeBenefits()
          statsOpen = true
        },
      })}
      {imageButton({
        key: 'leaderboard',
        src: 'images/leaderboard.png',
        width: 150,
        height: 90,
        label: 'Leaderboard',
        margin: '0 4px',
        onMouseDown: () => {
          openLeaderboard()
        },
      })}
      {isPreviewRealm()
        ? roundedButton({
            value: 'DEBUG: +1 brick (hold)',
            variant: 'secondary',
            margin: '0 4px',
            fontSize: 11,
            onMouseDown: () => {
              debugAddBrickHeld = true
              room.send('debugAddBrick', { ts: Date.now() })
            },
            onMouseUp: () => {
              debugAddBrickHeld = false
            },
            onMouseLeave: () => {
              debugAddBrickHeld = false
            },
          })
        : null}
      {isPreviewRealm()
        ? roundedButton({
            value: 'DEBUG: wipe profile',
            variant: 'secondary',
            margin: '0 4px',
            fontSize: 11,
            onMouseDown: () => {
              room.send('debugWipeProfile', { ts: Date.now() })
            },
          })
        : null}
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
    available >= nextCost(level, stats.perkPoints, key)
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
    >
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 0, left: 0 },
          width: '100%',
          height: '100%',
        }}
        uiBackground={{ color: panelBlack }}
        onMouseDown={() => {
          skillTreeOpen = false
          clearHoverTooltip()
        }}
      />
      <UiEntity
        uiTransform={{ width: 460, pointerFilter: 'block' }}
        onMouseDown={() => {}}
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
                value={`Available bricks: ${Math.floor(available)}    (lifetime ${Math.floor(
                  stats.lifetimeContributions
                )} − spent ${Math.floor(stats.bricksSpent)})`}
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
                cost: nextCost(stats.multiBricksLevel, stats.perkPoints, 'multiBricksLevel'),
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
                cost: nextCost(stats.pickupRadiusLevel, stats.perkPoints, 'pickupRadiusLevel'),
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
                cost: nextCost(stats.fasterSpawnsLevel, stats.perkPoints, 'fasterSpawnsLevel'),
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
                cost: nextCost(stats.leanDampenerLevel, stats.perkPoints, 'leanDampenerLevel'),
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
                cost: nextCost(stats.sturdyFoundationLevel, stats.perkPoints, 'sturdyFoundationLevel'),
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
                sub: `Personal. Your bricks straighten +${(plumbLinePersonalBonus(stats.plumbLineLevel) * 100).toFixed(0)}%.`,
                cost: nextCost(stats.plumbLineLevel, stats.perkPoints, 'plumbLineLevel'),
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
                sub: `World-wide. Eff ${getEffectivePlumbTeacherLevel().toFixed(2)}, +${(plumbLineTeacherBonus(getEffectivePlumbTeacherLevel()) * 100).toFixed(0)}% to all bricks.`,
                cost: nextCost(stats.plumbTeacherLevel, stats.perkPoints, 'plumbTeacherLevel'),
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
                cost: nextCost(stats.generousLevel, stats.perkPoints, 'generousLevel'),
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
                cost: nextCost(stats.generousTeacherLevel, stats.perkPoints, 'generousTeacherLevel'),
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
                cost: nextCost(stats.stockpileLevel, stats.perkPoints, 'stockpileLevel'),
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
                cost: nextCost(stats.titheLevel, stats.perkPoints, 'titheLevel'),
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
                  playGlobal('uiClick')
                  skillTreeOpen = false
                  clearHoverTooltip()
                },
              })}
            </UiEntity>
          ),
        })}
      </UiEntity>
    </UiEntity>
  )
}

function statsModal() {
  const stats = getMyStats()
  const available = stats.lifetimeContributions - stats.bricksSpent
  // Prestige gives a 2^max income multiplier per building. There's a benefit
  // any time some building's current max exceeds the snapshot taken at the
  // last prestige.
  const hasPrestigeBenefit = Object.keys(stats.maxBuildingLevel).some(
    (k) =>
      (stats.maxBuildingLevel[k] ?? 0) >
      (stats.prestigedMaxBuildingLevel[k] ?? 0)
  )
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
    >
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 0, left: 0 },
          width: '100%',
          height: '100%',
        }}
        uiBackground={{ color: panelBlack }}
        onMouseDown={() => {
          statsOpen = false
          clearHoverTooltip()
        }}
      />
      <UiEntity
        uiTransform={{ width: 460, pointerFilter: 'block' }}
        onMouseDown={() => {}}
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
                value="Your stats"
                fontSize={20}
                color={piazzaRed}
                uiTransform={{ width: '100%', height: 30 }}
              />

              {statsLine('Lifetime bricks', Math.floor(stats.lifetimeContributions))}
              {statsLine('Spent on upgrades', Math.floor(stats.bricksSpent))}
              {statsLine('Available', Math.floor(available))}

              <UiEntity
                uiTransform={{
                  width: '100%',
                  flexDirection: 'row',
                  margin: '12px 0 4px 0',
                }}
              >
                {statsHeaderCell({
                  label: 'Buildings',
                  width: '38%',
                  align: 'middle-left',
                  tooltip:
                    'Buildings\n\nThe six Italian landmarks. Each has its own level ladder and progression record.',
                })}
                {statsHeaderCell({
                  label: 'Builder',
                  width: '14%',
                  align: 'middle-center',
                  tooltip:
                    "Builder level\n\nYour highest personal level on this building. Bumps by +1 each time you beat a level at or above your current builder level — leapfrogging doesn't jump it more than +1 per completion.",
                })}
                {statsHeaderCell({
                  label: 'Income',
                  width: '15%',
                  align: 'middle-right',
                  tooltip:
                    'Income\n\nPer-brick income multiplier from this building, locked at 2^N where N is your builder level at the last Renaissance.',
                })}
                {statsHeaderCell({
                  label: 'After R’sance',
                  width: '17%',
                  align: 'middle-right',
                  tooltip:
                    "After Renaissance\n\nWhat Income would become if you Renaissance right now (2^current builder level). Highlighted when better than today's Income.",
                })}
                {statsHeaderCell({
                  label: 'Spawnable',
                  width: '16%',
                  align: 'middle-right',
                  tooltip:
                    'Spawnable\n\nThe highest level of this building you can encounter right now. Climbs as you beat buildings and grow your unlocked pool. Renaissance resets this pool — your builder level is unchanged but you have to climb back to face higher levels.',
                })}
              </UiEntity>

              {BUILDING_CONFIGS.map((cfg) =>
                buildingStatsRow({
                  name: cfg.displayName,
                  yourMax: stats.maxBuildingLevel[cfg.entityName] ?? 0,
                  prestigedMax:
                    stats.prestigedMaxBuildingLevel[cfg.entityName] ?? 0,
                  spawnable: highestSpawnableLevel(
                    stats.availableBuildings,
                    cfg.tier,
                    BUILDING_CONFIGS.length
                  ),
                })
              )}

              {(() => {
                const pool = perkPoolFor(stats.maxBuildingLevel)
                let allocated = 0
                for (const v of Object.values(stats.perkPoints)) allocated += v
                const unclaimed = Math.max(0, pool - allocated)
                return (
                  <UiEntity
                    uiTransform={{
                      width: '100%',
                      flexDirection: 'column',
                      margin: '14px 0 0 0',
                    }}
                  >
                    <Label
                      value={`Renaissance perks available: ${unclaimed}`}
                      fontSize={14}
                      color={unclaimed > 0 ? piazzaRed : black}
                      uiTransform={{ width: '100%', height: 22 }}
                      textAlign="middle-center"
                    />
                    <Label
                      value="Earn 1 perk per 3 total building max levels. Spend them at Renaissance for permanent free starting levels on any upgrade — fully respec-able each time."
                      fontSize={11}
                      color={Color4.create(0, 0, 0, 0.7)}
                      uiTransform={{
                        width: '100%',
                        height: 32,
                        margin: '4px 0 0 0',
                      }}
                      textAlign="middle-center"
                    />
                  </UiEntity>
                )
              })()}

              <UiEntity
                uiTransform={{
                  width: '100%',
                  height: 36,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  margin: '16px 0 0 0',
                }}
              >
                {roundedButton({
                  value: 'Renaissance…',
                  variant: hasPrestigeBenefit ? 'primary' : 'secondary',
                  width: 180,
                  height: 28,
                  onMouseDown: () => {
                    renaissanceDraft = { ...stats.perkPoints }
                    renaissanceOpen = true
                  },
                })}
                {roundedButton({
                  value: 'Close',
                  variant: 'secondary',
                  width: 100,
                  height: 28,
                  onMouseDown: () => {
                    playGlobal('uiClick')
                    statsOpen = false
                    clearHoverTooltip()
                  },
                })}
              </UiEntity>
            </UiEntity>
          ),
        })}
      </UiEntity>
    </UiEntity>
  )
}

function statsLine(label: string, value: number) {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        height: 20,
      }}
    >
      <Label
        value={label}
        fontSize={13}
        color={black}
        uiTransform={{ width: '60%', height: 20 }}
      />
      <Label
        value={`${value}`}
        fontSize={13}
        color={piazzaRed}
        uiTransform={{ width: '40%', height: 20 }}
        textAlign="middle-right"
      />
    </UiEntity>
  )
}

function buildingStatsRow(opts: {
  name: string
  yourMax: number
  prestigedMax: number
  spawnable: number
}) {
  const incomeMult = Math.pow(2, opts.prestigedMax)
  const afterMult = Math.pow(2, opts.yourMax)
  const increases = afterMult > incomeMult
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        flexDirection: 'row',
        padding: 4,
        margin: '2px 0',
        borderRadius: 4,
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.05) }}
    >
      <Label
        value={opts.name}
        fontSize={13}
        color={black}
        uiTransform={{ width: '38%', height: 20 }}
      />
      <Label
        value={`Lv ${opts.yourMax}`}
        fontSize={13}
        color={opts.yourMax > 0 ? piazzaRed : black}
        uiTransform={{ width: '14%', height: 20 }}
        textAlign="middle-center"
      />
      <Label
        value={opts.prestigedMax > 0 ? `×${incomeMult}` : '—'}
        fontSize={11}
        color={black}
        uiTransform={{ width: '15%', height: 20 }}
        textAlign="middle-right"
      />
      <Label
        value={opts.yourMax > 0 ? `×${afterMult}` : '—'}
        fontSize={11}
        color={increases ? piazzaRed : black}
        uiTransform={{ width: '17%', height: 20 }}
        textAlign="middle-right"
      />
      <Label
        value={opts.spawnable > 0 ? `Lv ${opts.spawnable}` : '—'}
        fontSize={11}
        color={black}
        uiTransform={{ width: '16%', height: 20 }}
        textAlign="middle-right"
      />
    </UiEntity>
  )
}

// Top spawn-pool level this player can face for a building of the given
// tier, given their availableBuildings counter (= highest unlocked pool
// index). 1-indexed; 0 means "not yet in the pool".
function highestSpawnableLevel(
  availableBuildings: number,
  tier: number,
  buildingCount: number
): number {
  if (availableBuildings < tier - 1) return 0
  return Math.floor((availableBuildings - (tier - 1)) / buildingCount) + 1
}

function statsHeaderCell(opts: {
  label: string
  width: any
  align: 'middle-left' | 'middle-center' | 'middle-right'
  tooltip: string
}) {
  return (
    <UiEntity
      uiTransform={{ width: opts.width, height: 20 }}
      onMouseEnter={() => {
        hoveredTooltip = opts.tooltip
        hoveredIcon = null
        hoveredTooltipAnchorRight = true
      }}
      onMouseLeave={() => {
        if (hoveredTooltip === opts.tooltip) {
          hoveredTooltip = null
          hoveredIcon = null
          hoveredTooltipAnchorRight = false
        }
      }}
    >
      <Label
        value={opts.label}
        fontSize={11}
        color={black}
        uiTransform={{ width: '100%', height: 20 }}
        textAlign={opts.align}
      />
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
  iconPath?: string
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
        hoveredIcon = opts.iconPath ?? null
        hoveredTooltipAnchorRight = true
      }}
      onMouseLeave={() => {
        if (hoveredTooltip === tooltip) {
          hoveredTooltip = null
          hoveredIcon = null
          hoveredTooltipAnchorRight = false
        }
      }}
    >
      <UiEntity
        uiTransform={{
          width: 36,
          height: 36,
          margin: '0 6px 0 0',
        }}
        uiBackground={{
          texture: { src: opts.iconPath ?? ICON_PLACEHOLDER },
          textureMode: 'stretch',
        }}
      />
      <UiEntity
        uiTransform={{
          width: 230,
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
          // Mouse leaves button but is still inside the row → restore row
          // tooltip. Anchor stays right (the row sets it on enter, clears
          // on leave). Only restore if we're still the button's tooltip —
          // guards against an adjacent row's enter having taken over.
          if (hoveredTooltip === buttonTooltip) hoveredTooltip = tooltip
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
            if (opts.canBuy && !opts.atMax) {
              playGlobal('skillUp')
              // The skill row re-renders on purchase (level + cost change),
              // which can detach the hover target without firing the row's
              // onMouseLeave. Clear the tooltip explicitly so it doesn't
              // linger after the buy.
              clearHoverTooltip()
              opts.onBuy()
            }
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
