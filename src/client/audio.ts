// One-shot audio playback helpers. Two entry points:
// - playGlobal(key) for UI sounds — flat volume, no positional falloff.
// - playAt(key, position) for in-world events — positional, falls off with
//   distance from the player.
//
// Both spawn a short-lived entity with an AudioSource and remove it after
// the clip duration. Cleanup runs every frame via audioCleanupSystem,
// which initClient registers via setupAudio().
import { AudioSource, engine, Entity, Transform } from '@dcl/sdk/ecs'

export const SOUNDS = {
  brickPickup: 'assets/sounds/brick_pickup.wav',
  uiClick: 'assets/sounds/ui_click.wav',
  skillUp: 'assets/sounds/skill_up.ogg',
  buildingPopup: 'assets/sounds/building_popup.ogg',
  collapse: 'assets/sounds/collapse.ogg',
  completion: 'assets/sounds/completion.ogg',
  renaissance: 'assets/sounds/renaissance.ogg',
} as const
export type SoundKey = keyof typeof SOUNDS

// Approximate clip durations (ms) used as auto-cleanup TTL.
const SOUND_DURATIONS_MS: Record<SoundKey, number> = {
  brickPickup: 1500,
  uiClick: 600,
  skillUp: 2500,
  buildingPopup: 3000,
  collapse: 2500,
  completion: 3500,
  renaissance: 3500,
}

// Default playback volume per sound. play* helpers fall back to these when
// no explicit volume is passed.
const SOUND_VOLUMES: Record<SoundKey, number> = {
  brickPickup: 1.0,
  uiClick: 0.5,
  skillUp: 1.0,
  buildingPopup: 1.0,
  collapse: 1.0,
  completion: 1.0,
  renaissance: 1.0,
}

type ActiveSound = { entity: Entity; expireAt: number }
const active: ActiveSound[] = []

export function setupAudio() {
  engine.addSystem(audioCleanupSystem)
}

function audioCleanupSystem(_dt: number) {
  const now = Date.now()
  for (let i = active.length - 1; i >= 0; i--) {
    if (active[i].expireAt <= now) {
      engine.removeEntity(active[i].entity)
      active.splice(i, 1)
    }
  }
}

export function playGlobal(key: SoundKey, volume?: number) {
  const e = engine.addEntity()
  Transform.create(e, { position: { x: 0, y: 0, z: 0 } })
  AudioSource.create(e, {
    audioClipUrl: SOUNDS[key],
    playing: true,
    volume: volume ?? SOUND_VOLUMES[key],
    global: true,
  })
  active.push({
    entity: e,
    expireAt: Date.now() + SOUND_DURATIONS_MS[key] + 200,
  })
}

export function playAt(
  key: SoundKey,
  position: { x: number; y: number; z: number },
  volume?: number
) {
  const e = engine.addEntity()
  Transform.create(e, { position })
  AudioSource.create(e, {
    audioClipUrl: SOUNDS[key],
    playing: true,
    volume: volume ?? SOUND_VOLUMES[key],
    global: false,
  })
  active.push({
    entity: e,
    expireAt: Date.now() + SOUND_DURATIONS_MS[key] + 200,
  })
}
