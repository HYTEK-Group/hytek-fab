import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'

// Force all routes dynamic — every page reads live Supabase session/data and
// must not be statically prerendered (Next.js 16 App Router). Propagates from
// the root layout to every nested route.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'HYTEK Fab',
  description: 'HYTEK Framing — structural steel fabrication management',
}

// Mobile-first: lock viewport so site crew don't accidentally pinch-zoom mid-log
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#231F20',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
