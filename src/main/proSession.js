import Store from 'electron-store'
import { safeStorage } from 'electron'

// Pro session token: encrypted at rest with the OS keychain (DPAPI on Windows).
// If OS encryption is unavailable the token is kept in memory only (sign-in per app run).
const store = new Store({ name: 'pro-account' })
let memory = null

export function getSession() {
  if (memory) return memory
  const saved = store.get('session')
  if (!saved?.token || !safeStorage.isEncryptionAvailable()) return null
  try {
    memory = {
      email: saved.email || null,
      token: safeStorage.decryptString(Buffer.from(saved.token, 'base64'))
    }
    return memory
  } catch {
    store.delete('session')
    return null
  }
}

export function setSession({ email, token }) {
  memory = { email, token }
  if (safeStorage.isEncryptionAvailable())
    store.set('session', {
      email: email || null,
      token: safeStorage.encryptString(token).toString('base64')
    })
}

export function clearSession() {
  memory = null
  store.delete('session')
}
