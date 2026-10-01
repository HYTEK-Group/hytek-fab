import { describe, it, expect } from 'vitest'
import { jobLabel } from '../job-label'

describe('jobLabel', () => {
  it('puts the job number first', () => {
    expect(jobLabel('26093002', 'Coral LAGOS 263Q — Lot 621, 20 Sagebrush Street'))
      .toBe('26093002 · Coral LAGOS 263Q — Lot 621, 20 Sagebrush Street')
  })
  it('shows the name alone when no number is known', () => {
    expect(jobLabel(null, 'Woollam')).toBe('Woollam')
    expect(jobLabel('  ', 'Woollam')).toBe('Woollam')
  })
  it('shows the number alone when no name is known', () => {
    expect(jobLabel('26093002', undefined)).toBe('26093002')
  })
  it('is empty when neither is known', () => {
    expect(jobLabel(null, null)).toBe('')
  })
})
