'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import Image from 'next/image'
import { useAuth } from '@/lib/auth-context'

const NAV = [
  { href: '/action', label: 'Action', icon: '◎' },
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

  // Worker/PIN roster + subcontractor access are admin/supervisor only.
  const navItems = [
    ...NAV,
    ...(profile?.role === 'admin' || profile?.role === 'supervisor'
      ? [
          { href: '/subs', label: 'Subs', icon: '⇄' },
          { href: '/admin/workers', label: 'Workers', icon: '☷' },
        ]
      : []),
  ]

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      {/* Frozen top ribbon: brand line + tab nav. Stays pinned as you scroll. */}
      <div className="sticky top-0 z-30" style={{ background: 'var(--background)' }}>
        {/* Brand line */}
        <header style={{ background: 'var(--background)' }} className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            {/* Brand mark returns to the HYTEK Hub portal (the launcher), not
                fab's own home — matches the rest of the suite. Cross-origin,
                so a plain <a>. */}
            <a href="https://hub.hytekframing.com.au/portal" aria-label="Back to HYTEK Hub" className="flex items-center">
              <Image src="/hytek-group-logo.png" alt="HYTEK" width={80} height={22} priority />
            </a>
            <span className="text-sm font-medium ml-1" style={{ color: 'var(--foreground)' }}>Fabrication</span>
          </div>
          <div className="flex items-center gap-3">
            {profile && (
              <span className="text-xs" style={{ color: 'var(--foreground)', fontWeight: 700 }}>
                {profile.full_name ?? profile.email}
              </span>
            )}
            <button
              onClick={handleSignOut}
              className="text-xs px-2 py-1 rounded"
              style={{ color: 'var(--text-3)', background: 'transparent', border: '0.5px solid var(--border)', minHeight: '28px' }}
            >
              Sign out
            </button>
          </div>
        </header>

        {/* Tab nav — a top ribbon now; underline marks the active tab */}
        <nav
          className="flex border-b"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
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
                  color: active ? 'var(--foreground)' : 'var(--text-2)',
                  fontWeight: active ? 700 : undefined,
                  borderBottom: active ? '2px solid var(--hytek-yellow)' : '2px solid transparent',
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

      {/* Content scrolls under the frozen ribbon */}
      <main>
        {children}
      </main>
    </div>
  )
}
