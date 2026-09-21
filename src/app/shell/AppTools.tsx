/*
  Author: Runor Ewhro
  Description: Exposes global Simulation inventory and enemy actions through persistent application chrome.
*/

import { FileImage, LibraryBig } from 'lucide-react'
import { useRtChrmMen } from '@/application/context-menu/routeMenuContext'
import { useAppStore } from '@/application/state'
import { selEnemyProf } from '@/application/state'
import { getEnemyIcon } from '@/domain/entities/enemy'
import { openEchoImport, openEnemyCnsl } from '@/modules/simulation/api/chrome'
import { withDefIconM } from '@/shared/lib/imageFallback'
import { Tooltip } from '@/shared/ui/Tooltip'

export function AppTools({ simulating = true }: { simulating?: boolean }) {
  const rtChrmMenu = useRtChrmMen()
  const enemy = useAppStore(selEnemyProf)
  const icon = getEnemyIcon(enemy.id) ?? '/assets/game/default.webp'
  const target = `Target · Lv ${enemy.level}`

  return (
    <>
      {simulating ? (
        <>
          <Tooltip content={target} placement="bottom">
            <button
              type="button" className="ax-g ax-g--target"
              aria-label={`Open the target console. ${target}`}
              onClick={openEnemyCnsl}
            >
              <img className="ax-face" src={icon} alt="" onError={withDefIconM} />
            </button>
          </Tooltip>

          <Tooltip content="Inventory" placement="bottom">
            <button
              type="button" className="ax-g"
              aria-label="Inventory"
              onClick={() => rtChrmMenu.actions.openInv()}
            >
              <LibraryBig aria-hidden="true" />
            </button>
          </Tooltip>
        </>
      ) : null}

      <Tooltip content="Import echoes" placement="bottom">
        <button
          type="button" className="ax-g"
          aria-label="Import echoes from a build card"
          onClick={() => openEchoImport()}
        >
          <FileImage aria-hidden="true" />
        </button>
      </Tooltip>
    </>
  )
}
