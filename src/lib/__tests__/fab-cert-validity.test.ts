import { describe, it, expect } from 'vitest'
import { checkCert } from '../fab-cert-validity'

const pad = (head: Buffer, size = 4096) => Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length))])

describe('checkCert', () => {
  it('accepts a real-sized PDF', () => {
    expect(checkCert(pad(Buffer.from('%PDF-1.7'))).ok).toBe(true)
  })
  it('accepts a real-sized JPG', () => {
    expect(checkCert(pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).ok).toBe(true)
  })
  it('accepts a real-sized PNG', () => {
    expect(checkCert(pad(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).ok).toBe(true)
  })
  it('rejects a blank / tiny file', () => {
    const v = checkCert(Buffer.from('%PDF-1.7'))
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/empty or too small/i)
  })
  it('rejects a non-PDF/non-image (e.g. a text or docx blob)', () => {
    const v = checkCert(pad(Buffer.from('PK\x03\x04 zipish')))
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/PDF or a photo/i)
  })
})
