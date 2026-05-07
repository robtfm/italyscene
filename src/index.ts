import {} from '@dcl/sdk/math'
import { engine, pointerEventsSystem, InputAction } from '@dcl/sdk/ecs'

import { setupUi, registerFountainClick } from './ui'
import { brickSpawnSystem, buildingSystem } from './game'

export function main() {
  engine.addSystem(brickSpawnSystem)
  engine.addSystem(buildingSystem)

  setupUi()

  const fountain = engine.getEntityOrNullByName('Fountain')
  if (fountain) {
    pointerEventsSystem.onPointerDown(
      {
        entity: fountain,
        opts: { button: InputAction.IA_PRIMARY, hoverText: 'Tocca la fontana' },
      },
      () => registerFountainClick()
    )
  }
}
