// GET /api/fab/marks/[id]/drawing — a short-lived signed URL to this assembly's
// shop drawing (the block ASSEMBLIES PDF, opened at its page when known). Lets a
// tap on an assembly open the drawing so the supervisor/worker can see the piece.
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getUserCaller } from '@/lib/fab-auth'
import { pickAssemblyDrawing } from '@/lib/fab-drawing-match'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserCaller(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const admin = getSupabaseAdmin()
  const { data: mark } = await admin
    .from('fab_marks')
    .select('mark_id, source_file, drawing_file, drawing_page, fab_jobs(quote_number)')
    .eq('id', id).single()
  if (!mark) return NextResponse.json({ error: 'Assembly not found' }, { status: 404 })
  const quote = (mark as { fab_jobs?: { quote_number?: string } }).fab_jobs?.quote_number
  if (!quote) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const { data: files } = await admin.storage.from('fab-drawings').list(quote, { limit: 100 })
  const names = (files ?? []).map(f => f.name)
  const target = (mark.drawing_file as string | null) ?? pickAssemblyDrawing(names, mark.source_file as string | null)
  if (!target) {
    return NextResponse.json({ error: 'No drawing found for this job yet', has_drawing: false }, { status: 404 })
  }

  const { data: signed, error } = await admin.storage.from('fab-drawings').createSignedUrl(`${quote}/${target}`, 3600)
  if (error || !signed) return NextResponse.json({ error: error?.message ?? 'Could not sign drawing' }, { status: 500 })

  const page = mark.drawing_page as number | null
  return NextResponse.json({
    url: signed.signedUrl + (page ? `#page=${page}` : ''),
    file: target,
    page: page ?? null,
    mark_id: mark.mark_id,
    exact_page: page != null, // false = opened at the top of the block drawing (find the mark)
  })
}
