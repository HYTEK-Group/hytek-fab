'use client'

import { AppShell } from '@/components/app-shell'

// Weekly SS tonnes — Day 2. Writes flow_fab_entries (the agreed table Hub reads;
// will move to POST {HUB_BASE}/api/flow/fab). Column shape to be reconciled
// against hytek-hub sql/flow/008-fab-weekly.sql before wiring the insert.
export default function WeeklyTonnesPage() {
  return (
    <AppShell>
      <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-xl">
        <h1 className="text-xl font-bold text-hytek-black">Weekly tonnes</h1>
        <p className="text-sm text-gray-500 mt-2">
          Building next. Enter SS tonnes produced this week per job → <code>flow_fab_entries</code>
          {' '}(Hub reads it for the Flow rollup).
        </p>
      </div>
    </AppShell>
  )
}
