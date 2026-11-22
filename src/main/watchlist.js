import Store from 'electron-store'
import { createWatchlistRepository, DEFAULT_ITEMS } from './watchlistRepository.js'

const store = new Store({
  name: 'watchlist',
  defaults: { items: DEFAULT_ITEMS }
})

// electron-store's whole-store setter performs one persisted write.
const repo = createWatchlistRepository({
  read: () => store.store,
  write: (value) => { store.store = value }
})

export const getItems = repo.getItems
export const addItem = repo.addItem
export const setItems = repo.setItems
export const updateHolding = repo.updateHolding
export const removeItem = repo.removeItem
export const reorderWatchlist = repo.reorderWatchlist
export const getActivitySummary = repo.getActivitySummary
export const exportActivity = repo.exportActivity
export const clearActivity = repo.clearActivity
