import { useEffect, useState } from 'react'

const GITHUB_URL = 'https://github.com/sngmng6506/stock-peek'
const CONTACT_EMAIL = 'sngmng6506@gmail.com'

function SettingsModal({ onClose }) {
  const [autoStart, setAutoStart] = useState(false)
  const [version, setVersion] = useState('')
  const [qr, setQr] = useState(null)
  const [updateAvailable, setUpdateAvailable] = useState(null)
  const [updateReady, setUpdateReady] = useState(null)

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setAutoStart(!!s.autoStart)
      setVersion(s.version || '')
    })
    window.api.getDonateQr().then(setQr)
    window.api.getUpdate().then((u) => {
      if (u?.available) setUpdateAvailable(u.available)
      if (u?.ready) setUpdateReady(u.ready)
    })
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

  const openExternal = (url) => () => window.api.openExternal(url)

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">설정</div>

        {updateReady && (
          <button
            type="button"
            className="update-banner ready"
            onClick={() => window.api.installUpdate()}
          >
            <span>v{updateReady.version} 다운로드 완료 — 클릭해서 재시작</span>
            <span>↻</span>
          </button>
        )}
        {!updateReady && updateAvailable && (
          <div className="update-banner downloading">
            <span>v{updateAvailable.version} 다운로드 중…</span>
          </div>
        )}

        <label className="setting-row">
          <span>윈도우 시작 시 자동 실행</span>
          <input type="checkbox" checked={autoStart} onChange={toggleAutoStart} />
        </label>

        <div className="donate">
          <div className="donate-title">☕ 커피값 후원</div>
          {qr ? (
            <img src={qr} className="donate-qr" alt="카카오페이 QR" />
          ) : (
            <div className="donate-placeholder">
              QR 이미지를 찾을 수 없어요.<br />
              <code>resources/icon_qr.jpg</code>에 파일이 있는지 확인하세요.
            </div>
          )}
          <div className="donate-hint">카카오페이로 스캔</div>
        </div>

        <div className="about">
          <div className="about-row">
            <span>버전</span>
            <span className="mono">{version || '-'}</span>
          </div>
          <button
            type="button"
            className="about-row link"
            onClick={openExternal(GITHUB_URL)}
          >
            <span>GitHub</span>
            <span>↗</span>
          </button>
          <button
            type="button"
            className="about-row link"
            onClick={openExternal(`mailto:${CONTACT_EMAIL}`)}
            title="이메일로 문의 보내기"
          >
            <span>문의</span>
            <span className="mono">{CONTACT_EMAIL}</span>
          </button>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="primary">
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
