import Store from 'electron-store'
import { randomUUID } from 'node:crypto'
import { createReportArchive } from '../shared/reportArchive.js'

// Generated report snapshots stay on this device; deleting one never touches the server.
const store = new Store({ name: 'ai-reports' })
export const reports = createReportArchive({
  read: () => store.get('data'),
  write: (value) => store.set('data', value),
  makeId: () => randomUUID()
})
