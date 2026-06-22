import Store from 'electron-store'

const store = new Store({
  name: 'preferences',
  defaults: {
    welcomeShown: false,
    dockPosition: { edge: 'right', y: 100 }
  }
})

export function isWelcomeShown() {
  return Boolean(store.get('welcomeShown'))
}

export function markWelcomeShown() {
  store.set('welcomeShown', true)
}

export function resetWelcome() {
  store.set('welcomeShown', false)
}

export function getDockPosition() {
  return store.get('dockPosition', { edge: 'right', y: 100 })
}

export function setDockPosition(pos) {
  store.set('dockPosition', pos)
}
