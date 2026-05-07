import { isServer } from '@dcl/sdk/network'
import { initServer } from './server/server'
import { initClient } from './client/setup'
import { setupUi } from './client/ui'

export async function main() {
  if (isServer()) {
    await initServer()
    return
  }
  initClient()
  setupUi()
}
