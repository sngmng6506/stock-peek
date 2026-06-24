import Store from 'electron-store'

const store = new Store({
  name: 'preferences',
  defaults: {
    welcomeShown: false,
    dockPosition: { edge: 'right', y: 100 },
    language: null // null이면 OS 언어 자동 감지
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

export function getLanguage() {
  return store.get('language', null)
}

export function setLanguage(lang) {
  store.set('language', lang === 'en' ? 'en' : 'ko')
}
