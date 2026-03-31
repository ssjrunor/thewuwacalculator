import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Shield } from 'lucide-react'

export function PrivacyPolicyPage() {
  const navigate = useNavigate()

  return (
    <div className="page">
      <header className="page-hero page-hero--split">
        <div>
          <div className="page-hero-eyebrow">Legal</div>
          <h1>Privacy Policy</h1>
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
            <div className="tile-icon tile-icon--blue"><Shield /></div>
            <div className="tile-header-text">
              <h3>Your Privacy</h3>
              <p>How we handle your data</p>
            </div>
          </div>

          <div className="tile-prose">
            <p>
              The Wuthering Waves Calculator is a fan-made tool designed to help users simulate and plan
              character builds. We value your privacy and aim to collect the minimum amount of personal
              information necessary to provide our services.
            </p>

            <h2>1. Data We Collect</h2>
            <ul>
              <li>
                <strong>Local Data Storage:</strong> Your calculator settings, team configurations, and
                preferences are stored locally in your browser using localStorage or similar methods. This
                data never leaves your device unless explicitly synced.
              </li>
              <li>
                <strong>Google Drive Sync (Optional):</strong> If you choose to connect your Google
                account, we access a private file in your{' '}
                <a
                  href="https://developers.google.com/drive/api/guides/appdata"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google Drive AppData folder
                </a>{' '}
                to back up and restore your calculator data.
              </li>
            </ul>

            <p>We do <strong>not</strong> collect or store:</p>
            <ul>
              <li>Names, emails, or personal identifiers</li>
              <li>
                Any personal or account data from Google beyond the limited tokens required for Drive backup
              </li>
              <li>Non-anonymized tracking data</li>
            </ul>

            <h2>2. How Your Data is Used</h2>
            <p>We use your data to:</p>
            <ul>
              <li>Persist your preferences and character data between sessions</li>
              <li>Enable cloud backup and restore using Google Drive (if opted-in)</li>
            </ul>
            <p>
              We <strong>never share</strong> your data with third parties.
            </p>

            <h2>3. Data Security</h2>
            <p>
              All synced data is stored in the hidden AppData folder of your own Google Drive account. Only
              you and the app (with your permission) can access it.
            </p>

            <h2>4. Third-Party Services</h2>
            <p>
              We use <strong>Google OAuth</strong> for sign-in and AppData access. We request only the
              minimal required scope and do not access your main Drive files.
            </p>
            <p>
              We use Google Analytics to measure overall site traffic (page visits, referrers, and similar
              statistics). Analytics operates in anonymized mode: IP addresses are masked, and no personally
              identifiable information is stored or shared. We do not use individual-level tracking or
              behavioral profiling.
            </p>

            <h2>5. Your Rights</h2>
            <p>You may:</p>
            <ul>
              <li>Disconnect your Google account at any time</li>
              <li>Delete all locally stored data via your browser</li>
              <li>Remove the synced backup from your Google Drive AppData folder</li>
            </ul>

            <p>
              For any concerns, contact me via{' '}
              <a href="mailto:rewhro@icloud.com?subject=Regarding%20the%20Calculator">email</a>.
            </p>

            <p className="page-last-updated">Last updated: 13 October 2025</p>
          </div>
        </section>
      </div>
    </div>
  )
}
