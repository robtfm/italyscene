// Renderer detection + per-renderer coordinate helpers.
//
// Decentraland has two renderers in the wild (Unity and Bevy) and they
// disagree on a couple of details — most painfully, PrimaryPointerInfo.y.
// The spec puts the origin at the top-left; Bevy follows it, Unity reports
// y inverted (origin bottom-left). Issue:
//   https://github.com/decentraland/unity-explorer/issues/8757
//
// We detect once at init via `getExplorerInformation()` and stash the
// renderer kind for the rest of the session.
import { getExplorerInformation } from '~system/Runtime'
import { UiCanvasInformation, engine } from '@dcl/sdk/ecs'

type Renderer = 'unity' | 'bevy' | 'unknown'
let rendererKind: Renderer = 'unknown'

export async function detectRenderer() {
  try {
    const info = await getExplorerInformation({})
    const agent = (info?.agent ?? '').toLowerCase()
    if (agent.includes('bevy') || agent.includes('rust')) {
      rendererKind = 'bevy'
    } else if (agent.includes('unity')) {
      rendererKind = 'unity'
    } else {
      rendererKind = 'unknown'
    }
    console.log(
      '[CLIENT] renderer detection: agent=',
      JSON.stringify(info?.agent),
      '→',
      rendererKind
    )
  } catch (e) {
    console.log('[CLIENT] renderer detection failed', e)
  }
}

export function isUnityRenderer(): boolean {
  return rendererKind === 'unity'
}

// Flip a reported screen y so callers always work in "top-left origin"
// space regardless of renderer. Bevy reports already-correct y; Unity
// returns viewport-y, which we mirror via the UI canvas height.
export function flipPointerY(reportedY: number): number {
  if (!isUnityRenderer()) return reportedY
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (!canvas) return reportedY
  return canvas.height - reportedY
}
