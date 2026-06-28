'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import Image from 'next/image'
import { useAuth } from '@/lib/auth-context'

const NAV = [
  { href: '/shop',   label: 'Shop',   icon: '⊞' },
  { href: '/ready',  label: 'Ready',  icon: '☑' },
  { href: '/crew',   label: 'Crew',   icon: '⊕' },
  { href: '/tonnes', label: 'Tonnes', icon: '⊘' },
  { href: '/report', label: 'Report', icon: '▦' },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { profile, signOut } = useAuth()
  const router = useRouter()

  async function handleSignOut() {
    await signOut()
    router.push('/login')
  }

  // Worker/PIN roster is admin/supervisor only.
  const navItems = [
    ...NAV,
    ...(profile?.role === 'admin' || profile?.role === 'supervisor'
      ? [{ href: '/admin/workers', label: 'Workers', icon: '☷' }]
      : []),
  ]

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--background)' }}>
      {/* Header */}
      <header style={{ background: '#231F20' }} className="flex items-center justify-between px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Image src="/hytek-group-logo.png" alt="HYTEK" width={80} height={22} priority />
          <span className="text-white text-sm font-medium ml-1">Fabrication</span>
        </div>
        <div className="flex items-center gap-3">
          {profile && (
            <span className="text-xs" style={{ color: '#FFCB05' }}>
              {profile.full_name ?? profile.email}
            </span>
          )}
          <button
            onClick={handleSignOut}
            className="text-xs px-2 py-1 rounded"
            style={{ color: '#888', background: 'transparent', border: '0.5px solid #333', minHeight: '28px' }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>

      {/* Bottom nav */}
      <nav
        className="flex border-t flex-shrink-0"
        style={{ background: '#1a1a1c', borderColor: 'var(--border)' }}
      >
        {navItems.map(({ href, label, icon }) => {
          // Shop owns the job board + individual job pages (/jobs/[id]).
          const active =
            pathname === href ||
            (href !== '/shop' && pathname.startsWith(href)) ||
            (href === '/shop' && pathname.startsWith('/jobs'))
          return (
            <Link
              key={href}
              href={href}
              className="flex-1 flex flex-col items-center justify-center py-2 text-xs gap-0.5"
              style={{
                color: active ? '#FFCB05' : '#555',
                borderTop: active ? '2px solid #FFCB05' : '2px solid transparent',
                minHeight: '52px',
              }}
            >
              <span className="text-base">{icon}</span>
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
