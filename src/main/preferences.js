import Store from 'electron-store'

const store = new Store({
  name: 'preferences',
  defaults: {
    welcomeShown: false
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
