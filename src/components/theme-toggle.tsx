'use client'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'
export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const isDark = mounted && resolvedTheme === 'dark'
  return (<button type="button" aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} title={isDark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setTheme(isDark ? 'light' : 'dark')} className="fixed bottom-4 left-4 z-50 inline-flex items-center justify-center w-11 h-11 rounded-full bg-card text-foreground border border-border shadow-lg hover:border-hytek-yellow hover:text-hytek-yellow transition-colors">{isDark ? <Sun className="w-5 h-5" strokeWidth={2} /> : <Moon className="w-5 h-5" strokeWidth={2} />}</button>)
}
