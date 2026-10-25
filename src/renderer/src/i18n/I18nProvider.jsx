import { useState, useEffect, useCallback } from 'react'
import { I18nContext } from './context'
import { translations } from './translations'

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState('ko')

  useEffect(() => {
    // 저장된 언어 우선, 없으면 OS 언어 감지
    window.api
      .getLanguage()
      .then((saved) => {
        if (saved) {
          setLangState(saved)
        } else {
          const sys = (navigator.language || 'ko').toLowerCase()
          setLangState(sys.startsWith('ko') ? 'ko' : 'en')
        }
      })
      .catch(() => {})
  }, [])

  const setLang = useCallback((l) => {
    setLangState(l)
    window.api.setLanguage(l).catch(() => {})
  }, [])

  const t = useCallback((key) => translations[lang]?.[key] ?? translations.ko[key] ?? key, [lang])

  return <I18nContext.Provider value={{ lang, t, setLang }}>{children}</I18nContext.Provider>
}
