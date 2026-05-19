function WelcomeModal({ onClose }) {
  const handleStart = async () => {
    await window.api.dismissWelcome()
    onClose()
  }

  return (
    <div className="modal-backdrop welcome-backdrop">
      <div className="modal welcome-modal">
        <div className="welcome-illust" aria-hidden="true">
          <div className="welcome-screen">
            <div className="welcome-panel-mini">
              <div className="welcome-bar"></div>
              <div className="welcome-bar"></div>
              <div className="welcome-bar"></div>
            </div>
            <div className="welcome-cursor">↖</div>
            <div className="welcome-arrow">→</div>
          </div>
        </div>

        <div className="welcome-title">몰래주식에 오신 걸 환영해요</div>

        <ol className="welcome-steps">
          <li>
            <span className="step-num">1</span>
            <div>
              <strong>마우스를 화면 우측 끝으로</strong>
              <div className="step-desc">패널이 슬라이드로 나타납니다.</div>
            </div>
          </li>
          <li>
            <span className="step-num">2</span>
            <div>
              <strong>＋ 버튼으로 종목 추가</strong>
              <div className="step-desc">
                종목명이나 티커로 검색해서 추가하세요.
              </div>
            </div>
          </li>
          <li>
            <span className="step-num">3</span>
            <div>
              <strong>트레이 아이콘 ⚙</strong>
              <div className="step-desc">
                자동 시작 토글 · 앱 종료는 트레이에서.
              </div>
            </div>
          </li>
        </ol>

        <div className="modal-actions">
          <button type="button" className="primary big-btn" onClick={handleStart}>
            시작하기
          </button>
        </div>
      </div>
    </div>
  )
}

export default WelcomeModal
