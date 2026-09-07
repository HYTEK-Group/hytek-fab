// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { jobNameFromFolder, jobRefFromFolder } from './job-ref.mjs'

describe('jobRefFromFolder', () => {
  it('reads the 8-digit mint number the bridge never looked for', () => {
    expect(jobRefFromFolder('26070101 - Smith Road')).toBe('26070101')
    expect(jobRefFromFolder('26070101')).toBe('26070101')
    expect(jobRefFromFolder('Woollam 26050104 Stage 2')).toBe('26050104')
  })

  it('still reads a legacy HG/HM reference, upper-cased', () => {
    expect(jobRefFromFolder('HG260001 Jones')).toBe('HG260001')
    expect(jobRefFromFolder('hg260018 - oxenford')).toBe('HG260018')
    expect(jobRefFromFolder('HM260007 Modular')).toBe('HM260007')
  })

  it('prefers the 8-digit number when a folder carries both', () => {
    // A renamed job keeps its old number in the title. The current mint wins.
    expect(jobRefFromFolder('26050104 (was HG260044) Beacon St')).toBe('26050104')
  })

  it('RETURNS NULL rather than inventing a number — the whole point of this file', () => {
    // The old inline code returned the folder name here, and the bridge then
    // upserted a fab_jobs row numbered "Misc".
    expect(jobRefFromFolder('Misc')).toBeNull()
    expect(jobRefFromFolder('Standard Details')).toBeNull()
    expect(jobRefFromFolder('')).toBeNull()
    expect(jobRefFromFolder('   ')).toBeNull()
    expect(jobRefFromFolder(undefined)).toBeNull()
  })

  it('does not read a longer digit run as an 8-digit number', () => {
    expect(jobRefFromFolder('260701012 something')).toBeNull()
    expect(jobRefFromFolder('1234567 old seven digit')).toBeNull()
  })
})

describe('jobNameFromFolder', () => {
  it('strips the reference off the front', () => {
    expect(jobNameFromFolder('26070101 - Smith Road')).toBe('Smith Road')
    expect(jobNameFromFolder('HG260001 Jones')).toBe('Jones')
  })

  it('keeps the whole name when stripping would leave nothing', () => {
    expect(jobNameFromFolder('26070101')).toBe('26070101')
    expect(jobNameFromFolder('Misc')).toBe('Misc')
  })
})
