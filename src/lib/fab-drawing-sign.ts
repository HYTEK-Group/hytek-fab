// Locates + signs the shop drawing for one assembly (mark). Shared by the
// internal /api/fab/marks/[id]/drawing route (open to any floor user) and the
// grant-gated /api/fab/sub/marks/[id]/drawing route — one implementation, two
// different auth walls in front of it.
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { pickAssemblyDrawing } from '@/lib/fab-drawing-match'

export interface SignedDrawing {
  url: string
  file: string
  page: number | null
  mark_id: string
  exact_page: boolean
}

export type DrawingResult =
  | { ok: true; drawing: SignedDrawing }
  | { ok: false; status: 404 | 500; error: string; has_drawing?: false }

/** Row shape the caller must fetch (lets the sub route also check scoping fields). */
export interface DrawingMarkRow {
  mark_id: string
  source_file: string | null
  drawing_file: string | null
  drawing_page: number | null
  quote_number: string | null
}

export async function signMarkDrawing(mark: DrawingMarkRow): Promise<DrawingResult> {
  if (!mark.quote_number) return { ok: false, status: 404, error: 'Job not found' }
  const admin = getSupabaseAdmin()

  const { data: files } = await admin.storage.from('fab-drawings').list(mark.quote_number, { limit: 100 })
  const names = (files ?? []).map(f => f.name)
  const target = mark.drawing_file ?? pickAssemblyDrawing(names, mark.source_file)
  if (!target) {
    return { ok: false, status: 404, error: 'No drawing found for this job yet', has_drawing: false }
  }

  const { data: signed, error } = await admin.storage
    .from('fab-drawings')
    .createSignedUrl(`${mark.quote_number}/${target}`, 3600)
  if (error || !signed) {
    return { ok: false, status: 500, error: error?.message ?? 'Could not sign drawing' }
  }

  const page = mark.drawing_page
  return {
    ok: true,
    drawing: {
      url: signed.signedUrl + (page ? `#page=${page}` : ''),
      file: target,
      page: page ?? null,
      mark_id: mark.mark_id,
      exact_page: page != null, // false = opened at the top of the block drawing (find the mark)
    },
  }
}
