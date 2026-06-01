/*
  Author: Runor Ewhro
  Description: Renders a shared loading overlay with overlay, centered,
               and scrim display modes for lazy content fallbacks.
*/

interface AppLdrVrlyPr {
  text?: string
  className?: string
  contentClass?: string
  mode?: 'overlay' | 'centered' | 'scrim'
}

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

export default function AppLdrVrly({
                                           text = 'Loading...',
                                           className = '',
                                           contentClass: contentClass = '',
                                           mode = 'overlay',
                                         }: AppLdrVrlyPr) {
  if (mode === 'scrim') {
    return (
        <div className={`app-loader-scrim ${className}`.trim()} aria-live="polite" aria-busy="true">
          {kaomoji}
          <span className="app-loader-fallback-text">{text}</span>
        </div>
    )
  }

  if (mode === 'centered') {
    return (
        <div className={`app-loader-fallback ${className}`.trim()} aria-live="polite" aria-busy="true">
          {kaomoji}
          <span className="app-loader-fallback-text">{text}</span>
        </div>
    )
  }

  return (
      <div className={`app-loader-overlay ${className}`.trim()} aria-live="polite" aria-busy="true">
        <div className={`app-loader-content ${contentClass}`.trim()}>
          <div className="app-loader-spinner" />
          <span className="app-loader-text">{text}</span>
        </div>
      </div>
  )
}
