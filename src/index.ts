import { isServer } from '@dcl/sdk/network'
import { initServer } from './server/server'
import { initClient } from './client/setup'
import { setupUi } from './client/ui'

export function main() {
  if (isServer()) {
    initServer()
    return
  }
  initClient()
  setupUi()
}
