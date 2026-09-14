/*
  Author: Runor Ewhro
  Description: Owns config modal behavior and state transitions for the components module.
*/

import { useState } from 'react'
import { Scale, TestTubes, X } from 'lucide-react'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import type { ReactNode } from 'react'
import {
  DAMAGE_DECIMALS,
  statCeiling,
} from '@/modules/simulation/features/rotation/program-editor/presentation/registerRows.ts'
import type {
  DamageDecimals,
  RegisterGroup,
  StatKey,
} from '@/modules/simulation/features/rotation/program-editor/presentation/registerRows.ts'
import { ColumnRack } from '@/modules/simulation/features/rotation/program-editor/components/ColumnRack.tsx'
import { useAppStore } from '@/domain/state/store.ts'
import type { RotationDamageBasis } from '@/domain/entities/rotationEditorPreferences.ts'

type ConfigTab = 'display' | 'simulation'
type ConfigConcern = 'rotation' | 'saved'
type ConfigScope = ConfigConcern | 'both'

interface ConfigSettings {
  view: 'tree' | 'flat'
  onView: (value: 'tree' | 'flat') => void
  ghostRepeats: boolean
  onGhostRepeats: (value: boolean) => void
  showPriors: boolean
  onShowPriors: (value: boolean) => void
  /** Ordered stat keys enabled for each execution entry. */
  statKeys: readonly StatKey[]
  onStatKeys: (value: readonly StatKey[]) => void
  /** the order the register's bands read in, left to right */
  groupOrder: readonly RegisterGroup[]
  onGroupOrder: (value: readonly RegisterGroup[]) => void

  dockPane: boolean
  onDockPane: (value: boolean) => void
  damageBasis: RotationDamageBasis
  onDamageBasis: (value: RotationDamageBasis) => void
  /** how many decimal places calculated rotation values state */
  decimals: DamageDecimals
  onDecimals: (value: DamageDecimals) => void
}

const CONFIGS = {
  layout: { tab: 'display', concern: 'rotation' },
  fadeRepeats: { tab: 'display', concern: 'rotation' },
  showPriors: { tab: 'display', concern: 'rotation' },
  dockPane: { tab: 'display', concern: 'both' },
  decimals: { tab: 'display', concern: 'both' },
  columns: { tab: 'display', concern: 'rotation' },
  damageBasis: { tab: 'simulation', concern: 'both' },
  showLiveRotation: { tab: 'display', concern: 'saved' },
  scaleSavedToSelected: { tab: 'display', concern: 'saved' },
} as const satisfies Record<string, { tab: ConfigTab; concern: ConfigScope }>

const TAB_NAMES: Array<{ id: ConfigTab; label: string }> = [
  { id: 'display', label: 'Display' },
  { id: 'simulation', label: 'Simulation' },
]

type ConfigKey = keyof typeof CONFIGS

function includesConcern(scope: ConfigScope, concern: ConfigConcern): boolean {
  return scope === 'both' || scope === concern
}

function tabsFor(concern: ConfigConcern) {
  return TAB_NAMES.map((tab) => ({
    ...tab,
    count: Object.values(CONFIGS).filter((config) => (
      config.tab === tab.id && includesConcern(config.concern, concern)
    )).length,
  })).filter((tab) => tab.count > 0)
}

function shows(config: ConfigKey, concern: ConfigConcern): boolean {
  return includesConcern(CONFIGS[config].concern, concern)
}

function Setting({
  name,
  why,
  children,
}: {
  name: string
  why: string
  children: ReactNode
}) {
  return (
    <div className="rtcfg-set">
      <span className="rtcfg-set__said">
        <b className="rtcfg-set__name">{name}</b>
        <span className="rtcfg-set__why">{why}</span>
      </span>
      {children}
    </div>
  )
}

/*
  a switch states itself rather than being read beside a label: the pill says
  which way it is set, and fills with the accent when it is on.
*/
function Toggle({
  on,
  label,
  onChange,
}: {
  on: boolean
  label: string
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`rtcfg-pill${on ? ' is-on' : ''}`}
      onClick={() => onChange(!on)}
    >
      {on ? 'On' : 'Off'}
    </button>
  )
}

function Choice<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: T
  options: Array<{ id: T; label: string }>
  label: string
  onChange: (value: T) => void
}) {
  return (
    <div className="rtcfg-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === value}
          className={`rtcfg-pill${option.id === value ? ' is-on' : ''}`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/*
  a set of columns rather than one value, so every option stands and the ones
  taken are filled. taking one it has no room for would mean dropping another
  without saying which, so past the limit the rest simply stop offering.
*/
export function ConfigModal({
  state,
  settings,
  onClose,
}: {
  state: { visible: boolean; open: boolean; closing: boolean }
  settings: ConfigSettings
  onClose: () => void
}) {
  const savedView = useAppStore((store) => store.ui.rotationEditorPreferences.savedView)
  const showLiveRotation = useAppStore(
    (store) => store.ui.savedRotationPreferences.showLiveRotation,
  )
  const scaleSavedToSelected = useAppStore(
    (store) => store.ui.savedRotationPreferences.scaleToSelected,
  )
  const setRotPrefs = useAppStore((store) => store.setRotPrefs)
  const surfaceConcern: ConfigConcern = savedView === 'off' ? 'rotation' : 'saved'
  const [tab, setTab] = useState<ConfigTab>('display')
  const [concern, setConcern] = useState<ConfigConcern>(surfaceConcern)
  const tabs = tabsFor(concern)
  const statMax = statCeiling(settings.dockPane)

  const selectConcern = (next: ConfigConcern) => {
    setConcern(next)
    if (!tabsFor(next).some((entry) => entry.id === tab)) {
      setTab('display')
    }
  }

  return (
    <AppModal
      state={state}
      variant="settings"
      ariaLabel="Rotation editor settings"
      onClose={onClose}
    >
      <div className="amdl rtcfg">
        <header className="amdl__head">
          <span className="amdl__title">
            <span className="amdl__over">Rotation editor</span>
            <b>Settings</b>
          </span>
          <span className="amdl__fill" />
          <span className="amdl__seg" role="group" aria-label="Settings concern">
            <button
              type="button"
              className={`amdl__seg-btn${concern === 'rotation' ? ' is-on' : ''}`}
              aria-pressed={concern === 'rotation'}
              title="Rotation view settings"
              aria-label="Rotation view settings"
              onClick={() => selectConcern('rotation')}
            >
              <TestTubes size="0.86rem" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`amdl__seg-btn${concern === 'saved' ? ' is-on' : ''}`}
              aria-pressed={concern === 'saved'}
              title="Saved rotation settings"
              aria-label="Saved rotation settings"
              onClick={() => selectConcern('saved')}
            >
              <Scale size="0.86rem" aria-hidden="true" />
            </button>
          </span>
          <button type="button" className="amdl__close" aria-label="Close" onClick={onClose}>
            <X size="0.95rem" />
          </button>
        </header>

        <div className="amdl__body rtcfg__body">
          <nav className="amdl__rail" aria-label="Settings sections">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-current={entry.id === tab ? 'true' : undefined}
                className={entry.id === tab ? 'amdl__tab is-on' : 'amdl__tab'}
                onClick={() => setTab(entry.id)}
              >
                <span className="amdl__tab-label">{entry.label}</span>
                <span className="amdl__tab-n">{entry.count}</span>
              </button>
            ))}
            <span className="amdl__rail-foot">
              {tabs.reduce((sum, entry) => sum + entry.count, 0)} settings
            </span>
          </nav>

          <div className="amdl__pane">
            {tab === 'display' ? (
              <div className="rtcfg__sets">
                {shows('layout', concern) ? <Setting
                  name="Layout"
                  why="Tree keeps a block's rows under it. Flat lists every row in the order it runs."
                >
                  <Choice
                    label="Layout"
                    value={settings.view}
                    options={[
                      { id: 'tree', label: 'Tree' },
                      { id: 'flat', label: 'Flat' },
                    ]}
                    onChange={settings.onView}
                  />
                </Setting> : null}

                {shows('fadeRepeats', concern) ? <Setting
                  name="Fade repeats"
                  why="Dim a stat that has not changed since the row above."
                >
                  <Toggle
                    label="Fade repeats"
                    on={settings.ghostRepeats}
                    onChange={settings.onGhostRepeats}
                  />
                </Setting> : null}

                {shows('showPriors', concern) ? <Setting
                  name="Show priors"
                  why="Keep the value a state changed from in view, instead of on hover."
                >
                  <Toggle
                    label="Show priors"
                    on={settings.showPriors}
                    onChange={settings.onShowPriors}
                  />
                </Setting> : null}

                {shows('showLiveRotation', concern) ? <Setting
                  name="Show live rotation"
                  why="Keep the current completed run in the saved list beside saved rotations."
                >
                  <Toggle
                    label="Show live rotation"
                    on={showLiveRotation}
                    onChange={(value) => setRotPrefs((current) => ({
                      ...current,
                      showLiveRotation: value,
                    }))}
                  />
                </Setting> : null}

                {shows('scaleSavedToSelected', concern) ? <Setting
                  name="Scale to the current entry"
                  why="Narrow the graph around the selected rotation. Turn it off to keep every entry on the full, flat graph."
                >
                  <Toggle
                    label="Scale to the current entry"
                    on={scaleSavedToSelected}
                    onChange={(value) => setRotPrefs((current) => ({
                      ...current,
                      scaleToSelected: value,
                    }))}
                  />
                </Setting> : null}

                {shows('dockPane', concern) ? <Setting
                  name="Keep the side panel open"
                  why="Keep the active side panel beside the current list instead of floating over it. The rotation view gives up five stat columns to make room."
                >
                  <Toggle
                    label="Keep the side panel open"
                    on={settings.dockPane}
                    onChange={settings.onDockPane}
                  />
                </Setting> : null}

                {shows('decimals', concern) ? <Setting
                  name="Decimals"
                  why="How precise supported calculated values read."
                >
                  <Choice
                    label="Decimals"
                    value={String(settings.decimals)}
                    options={DAMAGE_DECIMALS.map((places) => ({
                      id: String(places),
                      label: String(places),
                    }))}
                    onChange={(value) => settings.onDecimals(Number(value) as DamageDecimals)}
                  />
                </Setting> : null}

                {shows('columns', concern) ? <div className="rtcfg-set rtcfg-set--stacked">
                  <span className="rtcfg-set__said">
                    <b className="rtcfg-set__name">
                      Columns
                      <span className="rtcfg-set__count">
                        {settings.statKeys.length} of {statMax}
                      </span>
                    </b>
                    <span className="rtcfg-set__why">
                      Which factors a row states, and the order their bands read
                      in. Top to bottom here is left to right in the rotation.
                    </span>
                  </span>
                  <ColumnRack
                    statKeys={settings.statKeys}
                    onStatKeys={settings.onStatKeys}
                    groupOrder={settings.groupOrder}
                    onGroupOrder={settings.onGroupOrder}
                    ceiling={statMax}
                  />
                </div> : null}
              </div>
            ) : (
              <div className="rtcfg__sets">
                {shows('damageBasis', concern) ? <Setting
                  name="Total damage"
                  why="Would you rather see the FULL looped damage calculated or let the loop nodes average them out for you?"
                >
                  <Choice
                    label="Total damage"
                    value={settings.damageBasis}
                    options={[
                      { id: 'avg', label: 'Average' },
                      { id: 'full', label: 'Full' },
                    ]}
                    onChange={settings.onDamageBasis}
                  />
                </Setting> : null}

              </div>
            )}
          </div>
        </div>
      </div>
    </AppModal>
  )
}
