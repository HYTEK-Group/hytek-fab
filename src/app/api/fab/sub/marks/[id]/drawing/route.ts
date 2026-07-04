// GET /api/fab/sub/marks/[id]/drawing — the sub's view of ONE assembly drawing.
// Unlike the internal drawing route (deliberately open to any floor user), this
// is grant-gated: the mark must belong to a package granted to THIS sub, or the
// response is a 404 (not 403 — don't confirm the mark exists). Shares the same
// signing lib as the internal route.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSubCaller } from '@/lib/fab-sub-auth'
import { signMarkDrawing } from '@/lib/fab-drawing-sign'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getSubCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const admin = getSupabaseAdmin()
  const { data: mark } = await admin
    .from('fab_marks')
    .select('mark_id, source_file, drawing_file, drawing_page, contractor_package_id, fab_jobs(quote_number)')
    .eq('id', id).single()

  // Scoping wall: not found and not-yours look identical.
  const pkgId = mark?.contractor_package_id as string | null
  if (!mark || !pkgId || !caller.packages.some(p => p.package_id === pkgId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const result = await signMarkDrawing({
    mark_id: mark.mark_id,
    source_file: mark.source_file as string | null,
    drawing_file: mark.drawing_file as string | null,
    drawing_page: mark.drawing_page as number | null,
    quote_number: (mark as { fab_jobs?: { quote_number?: string } }).fab_jobs?.quote_number ?? null,
  })
  if (!result.ok) {
    const body: Record<string, unknown> = { error: result.error }
    if (result.has_drawing === false) body.has_drawing = false
    return NextResponse.json(body, { status: result.status })
  }
  return NextResponse.json(result.drawing)
}
