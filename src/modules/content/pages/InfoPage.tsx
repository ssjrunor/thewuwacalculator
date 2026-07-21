/*
  Author: Runor Ewhro
  Description: Renders the info page.
*/

import { Link } from 'react-router-dom'
import {
  Info,
  FlaskConical,
  User,
  Heart,
  MessageCircle as MsgCrcl,
  Scale,
} from 'lucide-react'
import { CllpPageHeyf } from '@/shared/ui/CollapsiblePageHero'

export function InfoPage() {
  return (
    <div className="page">
      <CllpPageHeyf
        eyebrow="About"
        title="About"
        subtitle="Reference calculator, formula tooling, and build analysis for Wuthering Waves."
        layoutKey="info-hero"
      />

      <div className="page-bento">
        <section className="page-tile page-tile--wide">
          <div className="tile-header">
            <div className="tile-icon"><Info /></div>
            <div className="tile-header-text">
              <h3>About this project</h3>
              <p>What it does and why it exists</p>
            </div>
          </div>
          <div className="tile-prose">
            <p>
              The Wuthering Waves Damage Calculator & Optimizer is a fan-made reference calculator for
              build analysis, formula checking, and stat comparison. It tracks live-patch character kits,
              echoes, weapons, and resonance chains, then turns those values into transparent damage
              estimates and optimizer reports.
            </p>
            <p>
              The site is not playable Wuthering Waves content and does not provide a game client,
              emulator, or game account service. Users enter build data, review calculations, and compare
              formula outputs in the browser.
            </p>
            <p>
              Goals: stay current with balance changes, keep formulas transparent, and help the community
              answer &ldquo;why did my damage change?&rdquo; as quickly as possible.
            </p>
          </div>
        </section>

        <section className="page-tile page-tile--narrow">
          <div className="tile-header">
            <div className="tile-icon tile-icon--purple"><User /></div>
            <div className="tile-header-text">
              <h3>Who builds it?</h3>
              <p>The person behind the project</p>
            </div>
          </div>
          <div className="tile-prose">
            <p>
              Designed, coded, and maintained by <strong>ssjrunor</strong>. This is an unofficial fan
              project and not affiliated with Kuro Games.
            </p>
          </div>
          <img
            src="https://tenor.com/o2OmfQuDdGw.gif"
            className="page-accent-img"
            alt=""
          />
        </section>

        <section className="page-tile page-tile--half">
          <div className="tile-header">
            <div className="tile-icon tile-icon--amber"><FlaskConical /></div>
            <div className="tile-header-text">
              <h3>Data + formulas</h3>
              <p>Where the numbers come from</p>
            </div>
          </div>
          <div className="tile-prose">
            <p>
              Gameplay values are pulled from in-game inspections plus community-maintained sources like{' '}
              <a href="https://encore.moe/?lang=en/" target="_blank" rel="noopener noreferrer">
                encore.moe
              </a>
              {' '}and{' '}
              <a href="https://nanoka.cc" target="_blank" rel="noopener noreferrer">
                nanoka.cc
              </a>
              . Damage math follows the{' '}
              <a
                href="https://wutheringwaves.fandom.com/wiki/Damage"
                target="_blank"
                rel="noopener noreferrer"
              >
                Wuthering Waves Wiki
              </a>{' '}
              model and ongoing community testing, with patch/catalog updates pulled into the app and tracked in the changelog.
            </p>
          </div>
        </section>

        <section className="page-tile page-tile--half">
          <div className="tile-header">
            <div className="tile-icon tile-icon--rose"><Heart /></div>
            <div className="tile-header-text">
              <h3>Community credits</h3>
              <p>The people who make it better</p>
            </div>
          </div>
          <div className="tile-prose">
            <p>
              Huge thanks to everyone in the Discord for ideas, bug finds, and sharing information about
              damage calculations. Community feedback keeps the numbers honest and the features pointed at
              real problems.
            </p>
          </div>
        </section>

        <section className="page-tile page-tile--half">
          <div className="tile-header">
            <div className="tile-icon tile-icon--blue"><MsgCrcl /></div>
            <div className="tile-header-text">
              <h3>Need help or want to hang out?</h3>
              <p>Come say hi</p>
            </div>
          </div>
          <div className="tile-prose">
            <p>
              Join the{' '}
              <a href="https://discord.gg/wNaauhE4uH" target="_blank" rel="noopener noreferrer">
                Discord
              </a>{' '}
              for support, feedback, or just to talk shop.
            </p>
          </div>
        </section>

        <section className="page-tile page-tile--half">
          <div className="tile-header">
            <div className="tile-icon tile-icon--green"><Scale /></div>
            <div className="tile-header-text">
              <h3>Legal</h3>
              <p>The fine print</p>
            </div>
          </div>
          <div className="info-legal-links">
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Service</Link>
          </div>
        </section>
      </div>
    </div>
  )
}
