import type { MetadataRoute } from 'next'

// PWA manifest — lets a subcontractor "Add to Home Screen" from /sub/<slug>.
// No square app icon exists in src/app yet, so the icons array is omitted
// (the type allows it); add icon.png later for a proper install icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HYTEK Fab — Subcontractor',
    short_name: 'HYTEK Fab',
    start_url: '/',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: '#FFCB05',
  }
}
