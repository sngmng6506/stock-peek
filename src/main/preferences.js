import Store from 'electron-store'
import { isSupportedLanguage } from '../shared/languages.js'

const store = new Store({
  name: 'preferences',
  defaults: {
    welcomeShown: false,
    dockPosition: { edge: 'right', y: 100, displayId: null },
    language: null // null이면 OS 언어 자동 감지
  }
})

export function isWelcomeShown() {
  return Boolean(store.get('welcomeShown'))
}

export function markWelcomeShown() {
  store.set('welcomeShown', true)
}

export function getDockPosition() {
  return store.get('dockPosition', { edge: 'right', y: 100, displayId: null })
}

export function setDockPosition(pos) {
  store.set('dockPosition', pos)
}

export function getLanguage() {
  const lang = store.get('language', null)
  return isSupportedLanguage(lang) ? lang : null
}

export function setLanguage(lang) {
  if (isSupportedLanguage(lang)) store.set('language', lang)
}
