// @vitest-environment node
//
// POST /api/fab/jobs/[id]/drawings — the door the office-server ingest bridge
// (scripts/ss-ingest-bridge.mjs) posts every shop drawing to. Until 17/09/2026
// the route only answered GET, so every drawing in every ingest run came back
// 405. These tests pin the door: who may use it, what it refuses, and where an
// accepted PDF lands in the fab-drawings bucket (the same `{job}/{file name}`
// path the bridge wrote directly before 07/09, so the drawing matcher still
// finds it).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => {
  const state = {
    caller: null as null | { role: string; name: string; ns: string; key: string },
    job: null as null | { quote_number: string },
    uploads: [] as Array<{ bucket: string; path: string; opts: Record<string, unknown>; size: number }>,
    uploadError: null as null | { message: string },
    dbTouched: 0,
  }
  const client = {
    from: () => {
      state.dbTouched++
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.single = async () => (state.job ? { data: state.job, error: null } : { data: null, error: { message: 'no rows' } })
      chain.maybeSingle = async () => ({ data: state.job, error: null })
      return chain
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Blob | Buffer, opts: Record<string, unknown>) => {
          const size = body instanceof Blob ? body.size : (body as Buffer).length
          state.uploads.push({ bucket, path, opts, size })
          return state.uploadError ? { data: null, error: state.uploadError } : { data: { path }, error: null }
        },
      }),
    },
  }
  return { state, client }
})

vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdmin: () => h.client }))
vi.mock('@/lib/fab-auth', () => ({
  getUserCaller: async () => h.state.caller,
  getSupervisorCaller: async () =>
    h.state.caller && (h.state.caller.role === 'supervisor' || h.state.caller.role === 'admin') ? h.state.caller : null,
}))

const { POST } = await import('./route')

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]) // "%PDF-1.7\n"

function post(file?: File | string) {
  const fd = new FormData()
  if (file !== undefined) fd.append('file', file)
  const req = new NextRequest('https://hytek-fab.vercel.app/api/fab/jobs/job-1/drawings', {
    method: 'POST',
    headers: { Authorization: 'Bearer kiosk-token' },
    body: fd,
  })
  return POST(req, { params: Promise.resolve({ id: 'job-1' }) })
}

const supervisor = { role: 'supervisor', name: 'SS Ingest Bridge', ns: 'kiosk', key: 'pin:SS Ingest Bridge' }

beforeEach(() => {
  Object.assign(h.state, { caller: supervisor, job: { quote_number: '26079902' }, uploads: [], uploadError: null, dbTouched: 0 })
})

describe('POST /api/fab/jobs/[id]/drawings', () => {
  it('is exported at all (the bridge got 405 for every drawing without it)', () => {
    expect(typeof POST).toBe('function')
  })

  it('refuses a caller with no token, before touching the database', async () => {
    h.state.caller = null
    const res = await post(new File([PDF], 'A1.pdf', { type: 'application/pdf' }))
    expect(res.status).toBe(403)
    expect(h.state.dbTouched).toBe(0)
    expect(h.state.uploads).toHaveLength(0)
  })

  it('refuses a fabricator — only a supervisor, admin or the bridge may add drawings', async () => {
    h.state.caller = { role: 'fabricator', name: 'Floor', ns: 'kiosk', key: 'pin:Floor' }
    const res = await post(new File([PDF], 'A1.pdf', { type: 'application/pdf' }))
    expect(res.status).toBe(403)
    expect(h.state.uploads).toHaveLength(0)
  })

  it('400s when there is no file field', async () => {
    const res = await post()
    expect(res.status).toBe(400)
    expect(h.state.uploads).toHaveLength(0)
  })

  it('400s on a file that is not a PDF', async () => {
    const res = await post(new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    expect(res.status).toBe(400)
    expect(h.state.uploads).toHaveLength(0)
  })

  it('400s on a .pdf name whose bytes are not a PDF', async () => {
    const res = await post(new File(['<html>'], 'fake.pdf', { type: 'application/pdf' }))
    expect(res.status).toBe(400)
    expect(h.state.uploads).toHaveLength(0)
  })

  it('404s on an unknown job', async () => {
    h.state.job = null
    const res = await post(new File([PDF], 'A1.pdf', { type: 'application/pdf' }))
    expect(res.status).toBe(404)
    expect(h.state.uploads).toHaveLength(0)
  })

  it('uploads a PDF to fab-drawings/{job number}/{file name}, replacing an older copy', async () => {
    const res = await post(new File([PDF], 'SS-26079902 A1 Rev B.pdf', { type: 'application/pdf' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, path: '26079902/SS-26079902 A1 Rev B.pdf' })
    expect(h.state.uploads).toEqual([
      {
        bucket: 'fab-drawings',
        path: '26079902/SS-26079902 A1 Rev B.pdf',
        opts: { contentType: 'application/pdf', upsert: true },
        size: PDF.length,
      },
    ])
  })

  it('keeps only the base name, so a name cannot climb out of the job folder', async () => {
    const res = await post(new File([PDF], '..\\..\\other-job\\A1.pdf', { type: 'application/pdf' }))
    expect(res.status).toBe(200)
    expect(h.state.uploads[0].path).toBe('26079902/A1.pdf')
  })

  it('accepts a PDF sent without a content type (the name and bytes decide)', async () => {
    const res = await post(new File([PDF], 'A2.PDF'))
    expect(res.status).toBe(200)
    expect(h.state.uploads[0].path).toBe('26079902/A2.PDF')
  })

  it('413s on a file over the size cap', async () => {
    const big = new Uint8Array(21 * 1024 * 1024)
    big.set(PDF)
    const res = await post(new File([big], 'huge.pdf', { type: 'application/pdf' }))
    expect(res.status).toBe(413)
    expect(h.state.uploads).toHaveLength(0)
  })

  it('500s with the storage message when the upload fails, so the bridge log says why', async () => {
    h.state.uploadError = { message: 'new row violates row-level security policy' }
    const res = await post(new File([PDF], 'A1.pdf', { type: 'application/pdf' }))
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('row-level security') })
  })
})
