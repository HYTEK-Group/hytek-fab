import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { Providers } from './providers'

// Jost is SELF-HOSTED (one variable woff2 covering wght 100–900, latin subset
// — replaces the five static cuts Google served; rendering unchanged).
// next/font/google downloads from Google at build/dev time and Turbopack's
// fetcher panics on some networks ("http2 feature is not enabled") → every
// page 500s in local dev. Same fix as hytek-hub PR #121.
const jost = localFont({
  src: './fonts/jost-latin-variable.woff2',
  weight: '100 900',
  variable: '--font-jost',
})

export const metadata: Metadata = {
  title: 'HYTEK Fabrication',
  description: 'HYTEK Framing — structural steel fabrication management',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#ffffff',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${jost.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
