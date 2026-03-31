import { useNavigate } from 'react-router-dom'
import { Cookie } from 'lucide-react'

interface CookieBannerProps {
  visible: boolean
  open: boolean
  closing: boolean
  onAccept: () => void
}

export function CookieBanner({ visible, open, closing, onAccept }: CookieBannerProps) {
  const navigate = useNavigate()

  if (!visible) return null

  return (
    <div
      className={`cookie-banner ${open ? 'open' : ''} ${closing ? 'closing' : ''}`}
      role="region"
      aria-label="Cookie consent"
    >
      <div className="cookie-banner__icon-wrap" aria-hidden="true">
        <Cookie size={18} />
      </div>
      <div className="cookie-banner__body">
        <p className="cookie-banner__text">
          Cookies are used for basic analytics only — nothing personal, nothing sold.{' '}
          <button
            type="button"
            className="cookie-banner__link"
            onClick={() => navigate('/privacy')}
          >
            Privacy Policy
          </button>
        </p>
      </div>
      <button
        type="button"
        className="cookie-banner__accept"
        onClick={onAccept}
      >
        Got it~
      </button>
    </div>
  )
}
