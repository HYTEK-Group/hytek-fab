// @ts-expect-error -- jsdom ships no types and @types/jsdom is not a dependency; the test environment already runs on it.
import { JSDOM, CookieJar } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { clearHostOnlyLoginCookies, sharedLoginStorage } from '../shared-login'

// D226 shared login against jsdom's real cookie engine (RFC 6265 rules for
// Domain, Secure, host-only and Max-Age), with one jar shared by several
// HYTEK addresses the way one browser shares it.

const KEY = 'sb-testproject-auth-token' // made up — no code may name the live project
const DOMAIN = 'hytekframing.com.au'
const SESSION = JSON.stringify({ access_token: 'x'.repeat(5000), refresh_token: 'r', user: { email: 'zoë@hytekframing.com.au' } })

function browser() {
  const jar = new CookieJar()
  const open = (url: string) => new JSDOM('', { url, cookieJar: jar }).window.document
  return { jar, open }
}

describe('shared login in a real cookie jar', () => {
  it('Hub login is seen by Fab, Purchasing and Dispatch, and not by other websites', async () => {
    const { open } = browser()
    sharedLoginStorage(DOMAIN, open('https://hub.hytekframing.com.au/')).setItem(KEY, SESSION)
    for (const url of ['https://fab.hytekframing.com.au/', 'https://purchasing.hytekframing.com.au/', 'https://dispatch.hytekframing.com.au/']) {
      expect(await sharedLoginStorage(DOMAIN, open(url)).getItem(KEY)).toBe(SESSION)
    }
    expect(open('https://hytek-fab.vercel.app/').cookie).toBe('')
    expect(open('https://example.com/').cookie).toBe('')
  })

  it('is never sent over plain http', () => {
    const { open } = browser()
    sharedLoginStorage(DOMAIN, open('https://hub.hytekframing.com.au/')).setItem(KEY, SESSION)
    expect(open('http://fab.hytekframing.com.au/').cookie).toBe('')
  })

  it('signing out in Fab signs out of the Hub too', async () => {
    const { open } = browser()
    sharedLoginStorage(DOMAIN, open('https://hub.hytekframing.com.au/')).setItem(KEY, SESSION)
    sharedLoginStorage(DOMAIN, open('https://fab.hytekframing.com.au/')).removeItem(KEY)
    expect(await sharedLoginStorage(DOMAIN, open('https://hub.hytekframing.com.au/')).getItem(KEY)).toBeNull()
    expect(open('https://hub.hytekframing.com.au/').cookie).toBe('')
  })

  it('clearing Purchasing\'s old host-only cookie keeps the shared login', async () => {
    const { open } = browser()
    const purchasing = open('https://purchasing.hytekframing.com.au/')
    purchasing.cookie = `${KEY}=old-host-only; Path=/; Secure`
    sharedLoginStorage(DOMAIN, open('https://hub.hytekframing.com.au/')).setItem(KEY, SESSION)
    clearHostOnlyLoginCookies(KEY, open('https://purchasing.hytekframing.com.au/'))
    expect(await sharedLoginStorage(DOMAIN, open('https://purchasing.hytekframing.com.au/')).getItem(KEY)).toBe(SESSION)
  })
})
