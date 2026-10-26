import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { LANGUAGES } from '../../../shared/languages.js'

const CONTACT_EMAIL = 'sngmng6506@gmail.com'
const SUPPORT_URL = 'https://ko-fi.com/sngmng'

function SettingsModal({ onClose }) {
  const { t, lang, setLang } = useI18n()
  const [autoStart, setAutoStart] = useState(false)
  const [version, setVersion] = useState('')
  const [updateAvailable, setUpdateAvailable] = useState(null)
  const [updateReady, setUpdateReady] = useState(null)
  const [qr, setQr] = useState(null)
  const [check, setCheck] = useState(null) // null | 'checking' | 'latest' | 'available' | 'ready' | 'error'

  useEffect(() => {
    window.api
      .getSettings()
      .then((s) => {
        setAutoStart(!!s.autoStart)
        setVersion(s.version || '')
      })
      .catch(() => {})
    window.api
      .getDonateQr()
      .then((d) => {
        if (d) setQr(d)
      })
      .catch(() => {})
    window.api
      .getUpdate()
      .then((u) => {
        if (u?.available) setUpdateAvailable(u.available)
        if (u?.ready) setUpdateReady(u.ready)
      })
      .catch(() => {})
    const u1 = window.api.onUpdateAvailable(setUpdateAvailable)
    const u2 = window.api.onUpdateReady(setUpdateReady)
    return () => {
      u1()
      u2()
    }
  }, [])

  const toggleAutoStart = async () => {
    const next = await window.api.setAutoStart(!autoStart)
    setAutoStart(!!next)
  }

  const checkUpdate = async () => {
    setCheck('checking')
    try {
      const r = await window.api.checkUpdate()
      setCheck(r?.status || 'error')
    } catch {
      setCheck('error')
    }
  }
  const checkLabel = {
    checking: t('settings.checking'),
    latest: t('settings.upToDate'),
    error: t('settings.checkFailed')
  }[check]

  const openExternal = (url) => () => window.api.openExternal(url)

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{t('settings.title')}</div>

        {updateReady && (
          <button
            type="button"
            className="update-banner ready"
            onClick={() => window.api.installUpdate()}
          >
            <span>
              v{updateReady.version} {t('settings.updateReady')}
            </span>
            <span>↻</span>
          </button>
        )}
        {!updateReady && updateAvailable?.manual && (
          <button
            type="button"
            className="update-banner ready"
            onClick={() => window.api.installUpdate()}
          >
            <span>
              v{updateAvailable.version} {t('settings.updateManual')}
            </span>
            <span>↓</span>
          </button>
        )}
        {!updateReady && updateAvailable && !updateAvailable.manual && (
          <div className="update-banner downloading">
            <span>
              v{updateAvailable.version} {t('settings.updateDownloading')}
            </span>
          </div>
        )}

        <label className="setting-row">
          <span>{t('settings.autostart')}</span>
          <input type="checkbox" checked={autoStart} onChange={toggleAutoStart} />
        </label>

        <div className="setting-row">
          <span>{t('settings.language')}</span>
          {LANGUAGES.length <= 3 ? (
            <div className="lang-seg">
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  className={lang === l.code ? 'active' : ''}
                  onClick={() => setLang(l.code)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          ) : (
            <select className="lang-select" value={lang} onChange={(e) => setLang(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="donate">
          <div className="donate-title">{t('settings.donate')}</div>
          <div className="donate-desc">{t('settings.donateDesc')}</div>
          <button type="button" className="support-btn" onClick={openExternal(SUPPORT_URL)}>
            ☕ {t('settings.donateBtn')}
          </button>
          {qr && (
            <div className="donate-qr">
              <img src={qr} alt="KakaoPay QR" />
              <div className="donate-qr-label">{t('settings.donateKakao')}</div>
            </div>
          )}
        </div>

        <div className="about">
          <div className="about-row">
            <span>{t('settings.version')}</span>
            <span className="version-actions">
              <span className="mono">{version || '-'}</span>
              <button
                type="button"
                className="check-update"
                onClick={checkUpdate}
                disabled={check === 'checking'}
              >
                {checkLabel || t('settings.checkUpdate')}
              </button>
            </span>
          </div>
          <button
            type="button"
            className="about-row link"
            onClick={openExternal(`mailto:${CONTACT_EMAIL}`)}
            title={t('settings.contactTitle')}
          >
            <span>{t('settings.contact')}</span>
            <span className="mono">{CONTACT_EMAIL}</span>
          </button>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="primary">
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
