import type { LeftPaneView } from '@/domain/entities/appState'

interface CalculatorSidebarProps {
  activeView: LeftPaneView
  isDark: boolean
  onSelect: (view: LeftPaneView) => void
}

const views: Array<{ key: LeftPaneView; label: string; icon: string }> = [
  { key: 'resonators', label: 'Resonators', icon: 'resonator' },
  { key: 'weapon', label: 'Weapon', icon: 'weapon' },
  { key: 'echoes', label: 'Echoes', icon: 'echoes' },
  { key: 'suggestions', label: 'Suggestions', icon: 'suggestions' },
  { key: 'teams', label: 'Team Buffs', icon: 'teams' },
  { key: 'enemy', label: 'Enemy', icon: 'enemy' },
  { key: 'buffs', label: 'Custom Buffs', icon: 'buffs' },
  { key: 'rotations', label: 'Rotation', icon: 'rotations' },
]

// renders the toolbar tabs that drive the left pane selection.
export function CalculatorSidebar({ activeView, isDark, onSelect }: CalculatorSidebarProps) {
  return (
    <section className="calculator-toolbar" aria-label="Calculator tool tabs">
      {views.map((view) => (
        <button
          key={view.key}
          type="button"
          className={view.key === activeView ? 'toolbar-tab active' : 'toolbar-tab'}
          title={view.label}
          onClick={() => onSelect(view.key)}
        >
          <span className="toolbar-tab-icon">
            <img
              src={`/assets/icons/${isDark ? 'dark' : 'light'}/${view.icon}.png`}
              alt={view.label}
              loading="lazy"
            />
          </span>
          <span className="toolbar-tab-label">{view.label}</span>
        </button>
      ))}
    </section>
  )
}
