'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AppShell } from '@/components/app-shell'

// Material receipt — Day 2. Heat number, ACRS soft-warn banner, mill-cert upload,
// and acknowledge-and-proceed checkboxes for any missing compliance field
// (permissive mode — never blocks). Writes fab_material_receipts.
export default function ReceiveMaterialPage() {
  const params = useParams<{ id: string }>()
  return (
    <AppShell>
      <Link href={`/jobs/${params?.id}`} className="text-sm text-gray-500 hover:text-gray-700">← Back to job</Link>
      <div className="bg-white rounded-xl border border-gray-200 p-8 mt-4 max-w-xl">
        <h1 className="text-xl font-bold text-hytek-black">Material receipt</h1>
        <p className="text-sm text-gray-500 mt-2">
          Building next. Heat number, supplier, ACRS soft-warn, mill-cert upload, and
          acknowledge-and-proceed checkboxes (permissive mode). Writes <code>fab_material_receipts</code>.
        </p>
      </div>
    </AppShell>
  )
}
