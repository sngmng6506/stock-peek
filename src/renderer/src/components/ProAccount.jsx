import { useState } from 'react'
import { useI18n } from '../i18n'
import { errorText } from '../lib/errors'

// No sign-in needed: top up and generate right away (an anonymous account is created on the
// first paid action). Linking an e-mail is optional and protects the balance across PCs.
// The session token never reaches the renderer; main returns only { email, credits }.
export default function ProAccount({ pro, onChange, busy, setBusy }) {
  const { t, lang } = useI18n()
  const [linking, setLinking] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [message, setMessage] = useState('')

  async function run(task) {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      await task()
    } catch (error) {
      setMessage(errorText(error, t))
    } finally {
      setBusy(false)
    }
  }

  const sendCode = () =>
    run(async () => {
      await window.api.requestProCode(email.trim())
      setCodeSent(true)
      setMessage(t('pro.codeSent'))
    })
  const verify = () =>
    run(async () => {
      onChange(await window.api.verifyProCode(email.trim(), code.trim()))
      setCode('')
      setCodeSent(false)
      setLinking(false)
    })
  const logout = () => run(async () => onChange(await window.api.logoutPro()))
  const refresh = () => run(async () => onChange(await window.api.getProStatus()))
  const topUp = () =>
    run(async () => {
      await window.api.openProCheckout()
      setMessage(t('pro.checkoutOpened'))
      onChange(await window.api.getProStatus())
    })

  const account = pro.account
  const available = account?.credits?.available ?? 0
  const price = pro.pack?.price
    ? new Intl.NumberFormat(lang === 'ko' ? 'ko-KR' : 'en-US').format(pro.pack.price)
    : ''

  return (
    <div className="ai-section">
      <strong>{t('pro.title')}</strong>
      <p className="ai-hint">
        {account && !account.credits ? t('pro.creditsUnknown') : t('pro.credits', { n: available })}
      </p>
      <div className="ai-report-actions">
        {pro.payments && (
          <button className="ai-secondary" type="button" disabled={busy} onClick={topUp}>
            {t('pro.topUp', { n: pro.pack.credits, v: price })}
          </button>
        )}
        {account && (
          <button className="ai-secondary" type="button" disabled={busy} onClick={refresh}>
            {t('pro.refresh')}
          </button>
        )}
      </div>

      {account?.email ? (
        <p className="ai-hint">
          {t('pro.linked', { v: account.email })}{' '}
          <button className="ai-link" type="button" disabled={busy} onClick={logout}>
            {t('pro.logout')}
          </button>
        </p>
      ) : (
        <>
          <p className="ai-hint">{t(account ? 'pro.linkHint' : 'pro.recoverHint')}</p>
          {!linking ? (
            <button className="ai-link" type="button" onClick={() => setLinking(true)}>
              {t(account ? 'pro.link' : 'pro.recover')}
            </button>
          ) : (
            <>
              <input
                className="ai-input"
                type="email"
                autoComplete="email"
                value={email}
                maxLength={254}
                placeholder={t('pro.emailPlaceholder')}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
              />
              {codeSent && (
                <input
                  className="ai-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  maxLength={6}
                  placeholder={t('pro.codePlaceholder')}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                  disabled={busy}
                />
              )}
              <div className="ai-report-actions">
                <button
                  className="ai-secondary"
                  type="button"
                  disabled={busy || !email.includes('@')}
                  onClick={sendCode}
                >
                  {t(codeSent ? 'pro.resendCode' : 'pro.sendCode')}
                </button>
                {codeSent && (
                  <button
                    className="primary"
                    type="button"
                    disabled={busy || code.length !== 6}
                    onClick={verify}
                  >
                    {t('pro.verify')}
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
      {message && (
        <p className="ai-hint" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
