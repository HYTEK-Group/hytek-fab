import { describe, expect, it } from 'vitest'
import { scrubEvent, stripQuery } from './sentry-scrub'

describe('stripQuery', () => {
  it('cuts at the query string or fragment', () => {
    expect(stripQuery('https://x.test/login?next=/jobs&token=abc')).toBe('https://x.test/login')
    expect(stripQuery('/jobs/123#notes')).toBe('/jobs/123')
    expect(stripQuery('/jobs/123')).toBe('/jobs/123')
  })
})

describe('scrubEvent', () => {
  it('drops the request body, cookies, query string and env, and cuts the url', () => {
    const event = scrubEvent({
      request: {
        url: 'https://app.test/api/login?email=a@b.c',
        data: '{"email":"a@b.c","password":"hunter2"}',
        cookies: { 'sb-access-token': 'eyJ...' },
        query_string: 'email=a@b.c',
        env: { REMOTE_ADDR: '10.0.0.1' },
      },
    })
    expect(event.request).toEqual({ url: 'https://app.test/api/login' })
    expect(JSON.stringify(event)).not.toContain('hunter2')
  })

  it('keeps only plain headers — no auth, cookies, tokens or custom headers', () => {
    const event = scrubEvent({
      request: {
        headers: {
          Authorization: 'Bearer secret',
          cookie: 'sb-access-token=eyJ',
          apikey: 'sb_secret_x',
          'x-hub-token': 't',
          'x-staff-pin': '1234',
          'x-forwarded-for': '1.2.3.4',
          'User-Agent': 'Mozilla/5.0',
          'content-type': 'application/json',
        },
      },
    })
    expect(event.request?.headers).toEqual({ 'User-Agent': 'Mozilla/5.0', 'content-type': 'application/json' })
  })

  it('reduces the user to an id', () => {
    expect(scrubEvent({ user: { id: 'u1', email: 'a@b.c', ip_address: '1.2.3.4' } as { id: string } }).user).toEqual({ id: 'u1' })
    expect(scrubEvent({ user: { email: 'a@b.c' } as { id?: string } }).user).toEqual({})
  })

  it('drops console breadcrumbs and cuts query strings from the rest', () => {
    const event = scrubEvent({
      breadcrumbs: [
        { category: 'console', data: { arguments: ['pin', '1234'] } },
        { category: 'fetch', data: { method: 'GET', url: '/api/jobs?token=abc', status_code: 500 } },
        { category: 'navigation', data: { from: '/a?x=1', to: '/b?y=2' } },
        { category: 'ui.click' },
      ],
    })
    expect(event.breadcrumbs).toEqual([
      { category: 'fetch', data: { method: 'GET', url: '/api/jobs', status_code: 500 } },
      { category: 'navigation', data: { from: '/a', to: '/b' } },
      { category: 'ui.click' },
    ])
  })

  it("cuts the query string from Next.js's request path", () => {
    const event = scrubEvent({ contexts: { nextjs: { request_path: '/reset?code=abc' } } })
    expect(event.contexts?.nextjs?.request_path).toBe('/reset')
  })

  it('passes an event with nothing to scrub straight through', () => {
    const event = { message: 'sentry wired' }
    expect(scrubEvent(event)).toBe(event)
    expect(event).toEqual({ message: 'sentry wired' })
  })
})
