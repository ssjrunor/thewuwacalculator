import { useNavigate } from 'react-router-dom'
import { Home } from 'lucide-react'

export function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="page not-found-page">
      <div className="not-found-center">
        <div className="not-found-code">404</div>
        <p className="not-found-message">The page you are looking for does not exist.</p>

        <img
          src="https://media1.tenor.com/m/6OJmN4DnIm0AAAAd/ericdoa-imagine-if-ninja-got-a-low-taper-fade.gif"
          alt=""
          className="not-found-gif"
        />

        <button type="button" className="page-back-btn" onClick={() => navigate('/')}>
          <Home size={14} />
          Go Home
        </button>
      </div>
    </div>
  )
}
