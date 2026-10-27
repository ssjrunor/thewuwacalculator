/*
  Author: Runor Ewhro
  description: mounts the game data import review.
*/

import { useGameImport } from './lib/store'
import { Review } from './Review'

export function Host() {
  const session = useGameImport((state) => state.session)
  const file = useGameImport((state) => state.file)
  const origin = useGameImport((state) => state.origin)
  const requestId = useGameImport((state) => state.requestId)
  const close = useGameImport((state) => state.close)
  const changeFile = useGameImport((state) => state.changeFile)
  const dismiss = useGameImport((state) => state.dismiss)
  const markShown = useGameImport((state) => state.markShown)
  if (!session || !file) return null
  return (
    <Review
      key={requestId}
      session={session}
      file={file}
      origin={origin}
      onLeave={dismiss}
      onShown={markShown}
      onGone={() => (useGameImport.getState().leaving === 'drop' ? changeFile() : close())}
    />
  )
}
