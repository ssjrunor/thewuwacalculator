/*
  Author: Runor Ewhro
  Description: Restores the saved appearance in a module graph independent of
               the application entry, including when the app graph fails.
*/

import { applyBootstrapAppearance, applyBootstrapUploadedWallpaper } from '@/application/persistence/bootstrapAppearance'

try {
  const uploadedWallpaperKey = applyBootstrapAppearance()
  if (uploadedWallpaperKey) {
    window.addEventListener('app:startup-notice', () => {
      void applyBootstrapUploadedWallpaper(uploadedWallpaperKey).catch((error) => {
        console.warn('Failed to restore startup wallpaper:', error)
      })
    }, { once: true })
  }
} catch (error) {
  console.warn('Failed to restore startup appearance:', error)
}
