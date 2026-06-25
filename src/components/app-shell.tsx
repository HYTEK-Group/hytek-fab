'use client'

import { ReactNode, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'

// AppShell — top chrome for every authenticated page. Brand header (yellow /
// black + HYTEK Group logo) + tab nav, matching the sibling apps.
const TABS = [
  { href: '/', label: 'Jobs' },
  { href: '/ready', label: 'Ready to fab' },
  { href: '/tonnes', label: 'Weekly tonnes' },
]

export function AppShell({ children }: { children: ReactNode }) {
  const { user, profile, loading, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [loading, user, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hytek-group-logo.png" alt="HYTEK GROUP" className="h-12 mb-4 mx-auto" />
          <p className="text-gray-500">Loading…</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-hytek-black text-white">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <Link href="/" className="hover:brightness-110 transition-all flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hytek-group-logo.png" alt="HYTEK GROUP" className="h-9" />
            </Link>
            <span className="text-sm text-gray-400 flex-shrink-0 hidden sm:inline">Fab Tracker</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium">{profile?.full_name ?? user.email}</p>
              {profile?.role && <p className="text-xs text-gray-400 capitalize">{profile.role}</p>}
            </div>
            <button
              onClick={() => signOut()}
              className="text-xs text-gray-400 hover:text-white border border-gray-600 px-3 py-1.5 rounded hover:border-gray-400 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>

        <nav className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1 flex-wrap items-end">
            {TABS.map((tab) => {
              const isActive = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                    isActive
                      ? 'bg-gray-50 text-hytek-black'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  {tab.label}
                </Link>
              )
            })}
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 py-6">{children}</div>
      </main>
    </div>
  )
}
