import Store from 'electron-store'
import { randomUUID } from 'node:crypto'

const store = new Store({
  name: 'preferences',
  defaults: {
    welcomeShown: false,
    dockPosition: { edge: 'right', y: 100, displayId: null },
    language: null, // null이면 OS 언어 자동 감지
    deviceId: null
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
  return store.get('language', null)
}

export function setLanguage(lang) {
  store.set('language', lang === 'en' ? 'en' : 'ko')
}

// 디바이스 식별자 (한 줄 평 하루 1회 제한용). 최초 1회 생성 후 영속.
export function getDeviceId() {
  let id = store.get('deviceId', null)
  if (!id) {
    id = randomUUID()
    store.set('deviceId', id)
  }
  return id
}
