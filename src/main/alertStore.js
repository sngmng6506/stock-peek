import Store from 'electron-store'
import { randomUUID } from 'node:crypto'
import { createAlertRepository } from './alertEngine.js'

const store = new Store({ name: 'price-alerts' })
export const alerts = createAlertRepository({
  read: () => store.get('data'),
  write: (data) => store.set('data', data),
  newId: randomUUID
})
