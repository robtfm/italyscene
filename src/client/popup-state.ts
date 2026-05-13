// Shared, generic popup state. Setters live here so producers (setup.ts
// `room.onMessage` handlers) and the consumer (ui.tsx toast renderer) don't
// need to import each other.
import { BUILDING_CONFIGS } from '../shared/buildings'

export type Popup = {
  title: string
  // Additional body lines (each one its own Label so we can colour-code).
  body: string[]
  // Optional hero image shown above the title (used by the Renaissance
  // popup; building-advance popups leave it unset).
  imageSrc?: string
}

let active: Popup | null = null

export function getPopup(): Popup | null {
  return active
}

export function clearPopup() {
  active = null
}

function buildingDisplayName(key: string): string {
  return BUILDING_CONFIGS.find((c) => c.entityName === key)?.displayName ?? key
}

export function showBuildingAdvance(buildingKey: string, level: number) {
  active = {
    title: 'New building level achieved!',
    body: [`${buildingDisplayName(buildingKey)} Lv ${level}`],
  }
}

export function showWelcome() {
  active = {
    title: 'Welcome to Marble & Mortar',
    body: [
      'Collect bricks scattered around you — each one raises the active Italian landmark and straightens its lean.',
      'Buildings collapse if they lean too far. Beat them at higher levels to unlock the next.',
      'Spend bricks on permanent upgrades in the Skill tree, or trigger a Renaissance from the Character page to compound your gains.',
      'Strive to become a legend of the Renaissance.',
    ],
  }
}

export function showPrestigeResult(
  prestigeLevel: number,
  advancesJson: string
) {
  let advances: { buildingKey: string; level: number }[] = []
  try {
    advances = JSON.parse(advancesJson)
  } catch {
    advances = []
  }
  const body: string[] = []
  if (advances.length > 0) {
    const parts = advances.map(
      (a) => `${buildingDisplayName(a.buildingKey)} ×${Math.pow(2, a.level)}`
    )
    body.push(`Income multiplier raised: ${parts.join(', ')}`)
  } else {
    body.push('No new building snapshots — pure fresh start.')
  }
  body.push('Upgrades, currency, and unlocked buildings have been reset.')
  active = {
    title: 'A Renaissance begins',
    body,
    imageSrc: 'images/level_up.png',
  }
}
