/*
  Author: Runor Ewhro
  Description: Renders a shared loading overlay with overlay, centered,
               and scrim display modes for lazy content fallbacks.
*/

interface AppLoaderOverlayProps {
  text?: string
  className?: string
  contentClassName?: string
  // 'overlay' positions absolutely over parent; 'centered' fills available space; 'scrim' shows a fixed modal-like overlay
  mode?: 'overlay' | 'centered' | 'scrim'
}

// shared centered kaomoji fallback content
const kaomoji = (
    <div className="app-loader-fallback-inner">
      <div className="app-loader-kaomoji">
        <span className="app-loader-dot app-loader-dot--1" aria-hidden="true" />
        <span className="app-loader-dot app-loader-dot--2" aria-hidden="true" />
        <span className="app-loader-dot app-loader-dot--3" aria-hidden="true" />
        <span className="app-loader-face" aria-hidden="true">( {'\u00B0\u30EE\u00B0'} )</span>
        <span className="app-loader-question" aria-hidden="true">?</span>
      </div>
    </div>
)

export default function AppLoaderOverlay({
                                           text = 'Loading...',
                                           className = '',
                                           contentClassName = '',
                                           mode = 'overlay',
                                         }: AppLoaderOverlayProps) {
  // fixed scrim-style fallback
  if (mode === 'scrim') {
    return (
        <div className={`app-loader-scrim ${className}`.trim()} aria-live="polite" aria-busy="true">
          {kaomoji}
          <span className="app-loader-fallback-text">{text}</span>
        </div>
    )
  }

  // full-area centered fallback
  if (mode === 'centered') {
    return (
        <div className={`app-loader-fallback ${className}`.trim()} aria-live="polite" aria-busy="true">
          {kaomoji}
          <span className="app-loader-fallback-text">{text}</span>
        </div>
    )
  }

  // default inline overlay fallback
  return (
      <div className={`app-loader-overlay ${className}`.trim()} aria-live="polite" aria-busy="true">
        <div className={`app-loader-content ${contentClassName}`.trim()}>
          <div className="app-loader-spinner" />
          <span className="app-loader-text">{text}</span>
        </div>
      </div>
  )
}