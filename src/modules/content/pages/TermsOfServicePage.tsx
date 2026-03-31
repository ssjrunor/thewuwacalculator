import { useNavigate } from 'react-router-dom'
import { ChevronLeft, FileText } from 'lucide-react'

export function TermsOfServicePage() {
  const navigate = useNavigate()

  return (
    <div className="page">
      <header className="page-hero page-hero--split">
        <div>
          <div className="page-hero-eyebrow">Legal</div>
          <h1>Terms of Service</h1>
          <p className="page-hero-meta">Effective Date: 13 October 2025</p>
        </div>
        <button type="button" className="page-back-btn" onClick={() => navigate(-1)}>
          <ChevronLeft size={14} />
          Back
        </button>
      </header>

      <div className="page-bento">
        <section className="page-tile page-tile--full">
          <div className="tile-header">
            <div className="tile-icon tile-icon--amber"><FileText /></div>
            <div className="tile-header-text">
              <h3>Terms</h3>
              <p>Rules for using this tool</p>
            </div>
          </div>

          <div className="tile-prose">
            <h2>1. Purpose</h2>
            <p>
              This app is a <strong>free, fan-made tool</strong> designed to help players of{' '}
              <em>Wuthering Waves</em> plan and simulate character builds, stats, and team compositions.
            </p>

            <h2>2. Usage Guidelines</h2>
            <p>You agree to:</p>
            <ul>
              <li>Use the app only for personal and non-commercial purposes</li>
              <li>Not attempt to abuse, reverse-engineer, or exploit the app or its features</li>
              <li>Use your own Google account responsibly if Drive sync is enabled</li>
            </ul>

            <h2>3. No Warranty</h2>
            <p>
              This tool is provided <strong>&ldquo;as is&rdquo;</strong> without any guarantees of accuracy,
              reliability, or availability. Use it at your own discretion.
            </p>

            <h2>4. Data Responsibility</h2>
            <ul>
              <li>
                You are responsible for any data stored in your browser or synced to your own Google Drive.
              </li>
              <li>
                We do not store or access your personal data beyond what is technically required for sync
                and functionality.
              </li>
              <li>
                Anonymous analytics (e.g., page views) may be collected through Google Analytics to improve
                usability. No personally identifiable information is stored or shared.
              </li>
            </ul>

            <h2>5. Disclaimer</h2>
            <p>
              This is an unofficial, fan-made app. We are not affiliated with Kuro Games or the developers
              of <em>Wuthering Waves</em>.
            </p>

            <h2>6. Changes</h2>
            <p>
              These terms may be updated occasionally to reflect new features or legal requirements.
              Continued use after updates implies acceptance of the revised terms.
            </p>

            <p className="page-last-updated">Last updated: 13 October 2025</p>
          </div>
        </section>
      </div>
    </div>
  )
}
