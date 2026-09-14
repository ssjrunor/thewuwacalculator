/*
  Author: Runor Ewhro
  Description: What a working surface reaches for from the line. Two so far:
               what you are building with, and what you are building against.
               The target belongs here rather than in a pane because every
               surface is calculating against it, whichever one is open.

               They are the same atom as the display switch and the links next
               to them, which is a bare glyph on the line's baseline. Nothing in
               the head is drawn inside anything, so neither are these: the
               target wears its own face because that is an asset, not a box,
               and the inventory's word moved into the tooltip so the run reads
               as one texture rather than a word among glyphs.
*/

import { FileImage, LibraryBig } from 'lucide-react'
import { useRtChrmMen } from '@/shared/context-menu/routeMenuContext'
import { useAppStore } from '@/domain/state/store'
import { selEnemyProf } from '@/domain/state/selectors'
import { getEnemyIcon } from '@/domain/entities/enemy'
import { openEnemyCnsl } from '@/modules/simulation/features/enemies/ConsoleHost'
import { withDefIconM } from '@/shared/lib/imageFallback'
import { openEchoImport } from '@/modules/simulation/features/echoes/lib/echoImportStore.ts'
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
