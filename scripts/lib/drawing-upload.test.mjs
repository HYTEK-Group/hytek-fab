// @vitest-environment node
//
// How the ingest bridge sends one shop drawing. Fab runs on Vercel, which
// refuses any request body over 4.5 MB before the route runs. 54 of the 2,316
// drawing PDFs on the drive are bigger than that (measured 17/09/2026),
// including the combined ASSEMBLIES PDFs the drawing matcher looks for first
// (up to 26 MB). So the PDF bytes must never go through fab: the bridge asks
// fab for a signed upload URL (a tiny JSON request) and PUTs the bytes to
// storage itself.
import { describe, expect, it } from 'vitest'
import { uploadDrawing } from './drawing-upload.mjs'

const PDF_HEAD = Buffer.from('%PDF-1.7\n', 'latin1')
const SIGNED = 'https://gqtikzguvhukpujyxkez.supabase.co/storage/v1/object/upload/sign/fab-drawings/26079902/A.pdf?token=t'

function pdfOf(bytes) {
  const b = Buffer.alloc(bytes)
  PDF_HEAD.copy(b)
  return b
}

function fakeFetch({ fab = { status: 200, body: { ok: true, path: '26079902/A.pdf', signedUrl: SIGNED } }, put = { status: 200, body: { Key: 'x' } } } = {}) {
  const calls = []
  const fn = async (url, init = {}) => {
    const size = init.body == null ? 0 : typeof init.body === 'string' ? Buffer.byteLength(init.body) : init.body.length
    calls.push({ url: String(url), method: init.method, headers: init.headers ?? {}, size, body: init.body })
    const r = String(url).startsWith('https://fab.test/') ? fab : put
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })
  }
  return { fn, calls }
}

const base = { fabUrl: 'https://fab.test', token: 'kiosk', jobId: 'job-1' }

describe('uploadDrawing', () => {
  it('sends a 26 MB assemblies PDF without putting its bytes through fab', async () => {
    const f = fakeFetch()
    const bytes = pdfOf(26 * 1024 * 1024)
    const r = await uploadDrawing({ ...base, name: 'HG260007 BEERWAH FIRE STATION FRS - ASSEMBLY_IFA 13.04.2026.pdf', bytes, fetch: f.fn })
    expect(r).toEqual({ ok: true, path: '26079902/A.pdf' })
    expect(f.calls).toHaveLength(2)

    const [ask, put] = f.calls
    expect(ask.url).toBe('https://fab.test/api/fab/jobs/job-1/drawings')
    expect(ask.method).toBe('POST')
    expect(ask.headers.Authorization).toBe('Bearer kiosk')
    expect(ask.headers['Content-Type']).toBe('application/json')
    expect(ask.size).toBeLessThan(4.5 * 1024 * 1024)
    expect(JSON.parse(ask.body)).toEqual({ name: 'HG260007 BEERWAH FIRE STATION FRS - ASSEMBLY_IFA 13.04.2026.pdf', size: bytes.length })

    expect(put.url).toBe(SIGNED)
    expect(put.method).toBe('PUT')
    expect(put.size).toBe(bytes.length)
    expect(put.headers['content-type']).toBe('application/pdf')
    expect(put.headers['x-upsert']).toBe('true')
  })

  it('refuses a .pdf whose bytes are not a PDF, without calling anyone', async () => {
    const f = fakeFetch()
    const r = await uploadDrawing({ ...base, name: 'fake.pdf', bytes: Buffer.from('<html>'), fetch: f.fn })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/not a PDF/)
    expect(f.calls).toHaveLength(0)
  })

  it('says which step failed and why when fab refuses (e.g. over the cap)', async () => {
    const f = fakeFetch({ fab: { status: 413, body: { error: 'Drawing is over 50 MB' } } })
    const r = await uploadDrawing({ ...base, name: 'A.pdf', bytes: pdfOf(10), fetch: f.fn })
    expect(r).toEqual({ ok: false, error: 'fab refused the upload: HTTP 413 Drawing is over 50 MB' })
    expect(f.calls).toHaveLength(1)
  })

  it('says storage refused the bytes when the signed PUT fails', async () => {
    const f = fakeFetch({ put: { status: 413, body: { message: 'The object exceeded the maximum allowed size' } } })
    const r = await uploadDrawing({ ...base, name: 'A.pdf', bytes: pdfOf(10), fetch: f.fn })
    expect(r).toEqual({ ok: false, error: 'storage refused the file: HTTP 413 The object exceeded the maximum allowed size' })
  })

  it('reports a fab answer with no signed URL instead of pretending it worked', async () => {
    const f = fakeFetch({ fab: { status: 200, body: { ok: true } } })
    const r = await uploadDrawing({ ...base, name: 'A.pdf', bytes: pdfOf(10), fetch: f.fn })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/no signed upload URL/)
    expect(f.calls).toHaveLength(1)
  })
})
