import Store from 'electron-store'
import { createThesisRepository } from '../shared/thesisModel.js'

const store = new Store({ name: 'investment-thesis' })
export const thesis = createThesisRepository({
  read: () => store.get('data'),
  write: (value) => store.set('data', value)
})
