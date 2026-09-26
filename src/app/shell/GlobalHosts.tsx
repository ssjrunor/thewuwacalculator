/*
  Author: Runor Ewhro
  Description: Mounts app-wide singleton hosts outside the route lifecycle so
               their state survives navigation.
*/

import { EchoImportHost, EnemyConsoleHost, ImportStamp } from '@/modules/simulation/api/chrome'
import { NavHold } from '@/app/nav/NavHold'
import { DlyNtc } from '@/app/shell/DailyNotice'
import { NtfcTstCntn } from '@/shared/ui/NotificationToast'
import { CookieBanner } from '@/app/shell/CookieBanner'
import { BetaNoticeModal } from '@/app/shell/BetaNoticeModal'
import { useCkBnnr } from '@/app/hooks/useCookieBanner.ts'

export function GlobalHosts({ simulating }: { simulating: boolean }) {
  const cookieBanner = useCkBnnr()

  return (
    <>
      <EchoImportHost />
      <ImportStamp />
      {simulating ? <EnemyConsoleHost /> : null}
      <NavHold />
      <DlyNtc />
      <NtfcTstCntn />
      <CookieBanner
        visible={cookieBanner.visible}
        open={cookieBanner.open}
        closing={cookieBanner.closing}
        onAccept={cookieBanner.accept}
      />
      {import.meta.env.MODE === 'beta' ? <BetaNoticeModal /> : null}
    </>
  )
}
