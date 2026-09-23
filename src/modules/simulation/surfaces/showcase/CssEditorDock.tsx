/*
  Author: Runor Ewhro
  Description: Owns transient custom-CSS editing and clipboard color sampling
               while preserving the serialized Showcase style contract.
*/

import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Check, Pipette, X } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { css } from '@codemirror/lang-css'

const CSS_EXTENSIONS = [css()]
const EDITOR_SETUP = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLine: true,
  highlightSelectionMatches: true,
}


export function ShowcaseCssEditorDock({
  value,
  isDark,
  onChange,
  onClose,
}: {
  value: string
  isDark: boolean
  onChange: (value: string) => void
  onClose: () => void
}) {
  const colorInputRef = useRef<HTMLInputElement>(null)
  const [pickedColor, setPickedColor] = useState('#5b8cff')
  const [copied, setCopied] = useState(false)

  const handlePickColor = (event: ChangeEvent<HTMLInputElement>) => {
    const hex = event.target.value
    setPickedColor(hex)
    setCopied(false)
    void navigator.clipboard?.writeText(hex).then(() => setCopied(true)).catch(() => {})
  }

  return (
    <div className="workspace-css-dock" data-phase="in">
      <header className="workspace-css-dock-head">
        <span className="workspace-css-dock-eyebrow">
          Custom CSS
        </span>
        <div className="workspace-css-dock-actions">
          <button
            type="button" className="workspace-css-dock-pick"
            onClick={() => colorInputRef.current?.click()}
            aria-label={copied ? `Copied ${pickedColor}` : 'Pick a color and copy its hex'}
          >
            <span className="workspace-css-dock-swatch" style={{ background: pickedColor }} aria-hidden="true" />
            <span className="workspace-css-dock-pick-label">{copied ? `${pickedColor} copied` : 'Pick color'}</span>
            {copied
              ? <Check size="0.8125rem" aria-hidden="true" />
              : <Pipette size="0.8125rem" aria-hidden="true" />}
          </button>
          <input
            ref={colorInputRef}
            type="color" className="workspace-css-dock-color-input"
            value={pickedColor}
            onChange={handlePickColor}
            tabIndex={-1}
            aria-hidden="true"
          />
          <button type="button" className="workspace-css-dock-close" onClick={onClose} aria-label="Collapse editor">
            <X size="0.875rem" aria-hidden="true" />
          </button>
        </div>
      </header>
      <CodeMirror
        value={value}
        height="100%"
        extensions={CSS_EXTENSIONS}
        basicSetup={EDITOR_SETUP}
        theme={isDark ? 'dark' : 'light'}
        onChange={onChange} className="workspace-css-dock-editor"
      />
      <p className="workspace-css-dock-note">
        Live, scoped to this card. Frame with <code>.workspace-rail</code>; reach any inner class like <code>.showcase-echo-name</code>.
      </p>
    </div>
  )
}
