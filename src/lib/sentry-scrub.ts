// Sentry privacy scrub — every crash report passes through this before it
// leaves the app. Decision #6 (15/09/2026): crash alerts in every app, and
// nothing private travels with them.
//
// Why a scrub and not just `sendDefaultPii: false` — measured in @sentry/core
// 10.57 before this was written:
//   - On the server the SDK buffers up to 10 KB of EVERY incoming request body
//     and attaches it to any error raised while that request runs. It does so
//     whatever `sendDefaultPii` says (the body is stored at write time; the
//     setting only gates reading). A crash inside a login or PIN route would
//     have sent the password. The server config now turns body capture off
//     (`maxIncomingRequestBodySize: 'none'`); this scrub is the second lock.
//   - Headers go out with a deny-list of name fragments, so a header it does
//     not recognise goes out as-is.
//   - Next.js hands Sentry the request path WITH its query string.
//
// So keep what diagnoses a crash — the error, the stack, the route, the method,
// the browser — and drop what identifies a person or opens a door: bodies,
// cookies, query strings, every header but a few plain ones, user details, and
// console breadcrumbs (whatever the code happened to log).
//
// PURE — no Sentry import, so it is tested without the SDK.

const SAFE_HEADERS = new Set(['host', 'user-agent', 'accept', 'content-type', 'content-length'])

type Scrubbable = {
  request?: {
    url?: string
    data?: unknown
    cookies?: unknown
    query_string?: unknown
    env?: unknown
    headers?: Record<string, string>
  }
  user?: { id?: string | number }
  breadcrumbs?: { category?: string; data?: Record<string, unknown> }[]
  contexts?: { nextjs?: { request_path?: unknown } }
}

/** Cut a URL or path at its query string or fragment. */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

// Takes any event shape (Sentry's ErrorEvent, or a plain object in tests) and
// hands the same object back, so it drops straight into `beforeSend`.
export function scrubEvent<E extends object>(event: E): E {
  const e = event as Scrubbable

  const req = e.request
  if (req) {
    delete req.data
    delete req.cookies
    delete req.query_string
    delete req.env
    if (typeof req.url === 'string') req.url = stripQuery(req.url)
    if (req.headers) {
      const kept: Record<string, string> = {}
      for (const [name, value] of Object.entries(req.headers)) {
        if (SAFE_HEADERS.has(name.toLowerCase())) kept[name] = value
      }
      req.headers = kept
    }
  }

  if (e.user) e.user = e.user.id !== undefined ? { id: e.user.id } : {}

  if (e.breadcrumbs) {
    e.breadcrumbs = e.breadcrumbs
      .filter((b) => b.category !== 'console')
      .map((b) => {
        if (!b.data) return b
        const data = { ...b.data }
        for (const key of ['url', 'from', 'to']) {
          const v = data[key]
          if (typeof v === 'string') data[key] = stripQuery(v)
        }
        return { ...b, data }
      })
  }

  const nextjs = e.contexts?.nextjs
  if (nextjs && typeof nextjs.request_path === 'string') {
    nextjs.request_path = stripQuery(nextjs.request_path)
  }

  return event
}
