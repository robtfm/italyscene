// Shared popup state. Kept out of setup.ts and ui.tsx so the message
// producer (setup.ts) and consumer (ui.tsx) don't need to import each other.
import { BUILDING_CONFIGS } from '../shared/buildings'

let buildingAdvance: string | null = null

export function getBuildingAdvance(): string | null {
  return buildingAdvance
}

export function clearBuildingAdvance() {
  buildingAdvance = null
}

export function showBuildingAdvance(buildingKey: string, level: number) {
  const cfg = BUILDING_CONFIGS.find((c) => c.entityName === buildingKey)
  const name = cfg?.displayName ?? buildingKey
  buildingAdvance = `${name} Lv ${level}!`
}
