import { createContext } from 'react'

export const I18nContext = createContext({ lang: 'ko', t: (k) => k, setLang: () => {} })
