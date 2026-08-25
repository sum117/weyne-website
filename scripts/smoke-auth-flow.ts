/**
 * Live end-to-end smoke of the login/logout journey against a running
 * production runtime. Development utility; not part of any suite.
 *
 *   WEYNE_SMOKE_ORIGIN=http://127.0.0.1:3199 \
 *   WEYNE_SMOKE_EMAIL=... WEYNE_SMOKE_PASSWORD=... \
 *     bun scripts/smoke-auth-flow.ts
 *
 * Server-function calls are made over raw HTTP with the same seroval wire
 * format the browser client uses, so the checks exercise the real RPC
 * boundary rather than a convenience wrapper.
 */
import { fromCrossJSON, toJSONAsync } from 'seroval'

const origin = process.env.WEYNE_SMOKE_ORIGIN ?? 'http://127.0.0.1:3199'
const email = process.env.WEYNE_SMOKE_EMAIL
const password = process.env.WEYNE_SMOKE_PASSWORD
const signInId = process.env.WEYNE_SMOKE_SIGNIN_ID
const signOutId = process.env.WEYNE_SMOKE_SIGNOUT_ID

if (!email || !password || !signInId || !signOutId) {
  console.error(
    'Set WEYNE_SMOKE_EMAIL, WEYNE_SMOKE_PASSWORD, WEYNE_SMOKE_SIGNIN_ID and WEYNE_SMOKE_SIGNOUT_ID',
  )
  process.exit(1)
}

const results: Array<[string, boolean, string]> = []
function check(label: string, passed: boolean, detail = '') {
  results.push([label, passed, detail])
}

type RpcOptions = Readonly<{
  data?: unknown
  cookie?: string
  origin?: string | null
}>

async function callServerFn(functionId: string, options: RpcOptions = {}) {
  const headers = new Headers({ 'x-tsr-serverFn': 'true' })
  const requestOrigin = options.origin === undefined ? origin : options.origin
  if (requestOrigin !== null) headers.set('origin', requestOrigin)
  if (options.cookie) headers.set('cookie', options.cookie)

  let body: string | undefined
  if (options.data !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(await toJSONAsync({ data: options.data }))
  }

  const response = await fetch(`${origin}/_serverFn/${functionId}`, {
    method: 'POST',
    headers,
    body,
  })
  const text = await response.text()
  let payload: unknown = text
  if (response.headers.get('content-type')?.includes('application/json')) {
    try {
      payload = fromCrossJSON(JSON.parse(text), { refs: new Map() })
    } catch {
      payload = text
    }
  }
  return { response, payload, text }
}

function sessionCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0]!)
    .filter((value) => !value.endsWith('='))
    .join('; ')
}

// 1. Anonymous /app redirects to the login page before rendering anything.
const anonymous = await fetch(`${origin}/app`, { redirect: 'manual' })
const anonymousBody = await anonymous.text()
check(
  'anonymous /app redirects to login',
  anonymous.status === 307 &&
    anonymous.headers.get('location') === '/entrar?redirect=%2Fapp',
  `${anonymous.status} ${anonymous.headers.get('location')}`,
)
check(
  'redirect body leaks no protected markup',
  !anonymousBody.includes('data-server-rendered-at'),
)

// 2. The login page renders for an anonymous visitor.
const loginPage = await fetch(`${origin}/entrar`, { redirect: 'manual' })
const loginHtml = await loginPage.text()
check(
  'login page renders for an anonymous visitor',
  loginPage.status === 200 &&
    loginHtml.includes('Entrar') &&
    loginHtml.includes('E-mail'),
  String(loginPage.status),
)

// A deliberately wrong credential, derived from the supplied one rather than
// written as a literal, so no password-shaped string is committed.
const wrongPassword = `${password}-invalido`

// 3. Wrong credentials are refused with the non-enumerating message.
const wrong = await callServerFn(signInId, {
  data: { email, password: wrongPassword },
})
check(
  'wrong password refused with the shared message and no cookie',
  JSON.stringify(wrong.payload).includes('INVALID_CREDENTIALS') &&
    wrong.response.headers.getSetCookie().length === 0,
  `${wrong.response.status} ${wrong.text.slice(0, 160)}`,
)

// 4. An unknown address gets the SAME answer, so the form cannot enumerate.
const unknown = await callServerFn(signInId, {
  data: { email: 'ninguem@example.test', password: wrongPassword },
})
check(
  'unknown address is indistinguishable from a wrong password',
  JSON.stringify(unknown.payload) === JSON.stringify(wrong.payload),
  `${unknown.text.slice(0, 160)}`,
)

// 5. A cross-origin server-function POST is rejected before the handler runs.
const crossSite = await callServerFn(signInId, {
  data: { email, password },
  origin: 'https://attacker.example',
})
check(
  'cross-origin server-function POST is rejected',
  crossSite.response.status === 403 &&
    crossSite.response.headers.getSetCookie().length === 0,
  String(crossSite.response.status),
)

// 6. Valid credentials establish a hardened session cookie.
const signedIn = await callServerFn(signInId, { data: { email, password } })
const cookie = sessionCookie(signedIn.response)
const setCookie = signedIn.response.headers.getSetCookie().join(' | ')
check(
  'valid login returns the session projection',
  signedIn.response.status === 200 && signedIn.text.includes(email),
  `${signedIn.response.status} ${signedIn.text.slice(0, 200)}`,
)
check(
  'session cookie is HttpOnly, SameSite=Lax, Path=/',
  cookie.length > 0 &&
    setCookie.includes('HttpOnly') &&
    setCookie.includes('SameSite=Lax') &&
    setCookie.includes('Path=/'),
  setCookie,
)
check(
  'login response body carries no session token',
  !signedIn.text.includes(cookie.split('=')[1]?.slice(0, 16) ?? 'IMPOSSIBLE') &&
    !/authSubject|auth_subject|password/i.test(signedIn.text),
  signedIn.text.slice(0, 200),
)

// 7. The cookie survives a full document reload of /app.
const reloaded = await fetch(`${origin}/app`, {
  headers: { cookie },
  redirect: 'manual',
})
const reloadedHtml = await reloaded.text()
check(
  'authenticated reload stays authenticated',
  reloaded.status === 200 &&
    reloadedHtml.includes('data-server-rendered-at') &&
    reloadedHtml.includes(email),
  String(reloaded.status),
)

// 8. An authenticated visitor is bounced off the login page.
const loginWhileAuthenticated = await fetch(`${origin}/entrar`, {
  headers: { cookie },
  redirect: 'manual',
})
await loginWhileAuthenticated.text()
check(
  'authenticated visitor is redirected away from the login page',
  loginWhileAuthenticated.status === 307 &&
    loginWhileAuthenticated.headers.get('location') === '/app',
  `${loginWhileAuthenticated.status} ${loginWhileAuthenticated.headers.get('location')}`,
)

// 9. Logout revokes the session server-side and expires the cookie.
const signedOut = await callServerFn(signOutId, { cookie })
check(
  'logout expires the session cookie',
  signedOut.response.status === 200 &&
    signedOut.response.headers
      .getSetCookie()
      .some((value) => value.includes('Max-Age=0')),
  `${signedOut.response.status} ${signedOut.response.headers.getSetCookie().join(' | ')}`,
)

// 10. The old cookie cannot regain access.
const replay = await fetch(`${origin}/app`, {
  headers: { cookie },
  redirect: 'manual',
})
const replayBody = await replay.text()
check(
  'revoked cookie cannot regain access',
  replay.status === 307 &&
    replay.headers.get('location') === '/entrar?redirect=%2Fapp' &&
    !replayBody.includes('data-server-rendered-at'),
  `${replay.status} ${replay.headers.get('location')}`,
)

// 11. The public route is untouched.
const home = await fetch(`${origin}/`, { redirect: 'manual' })
const homeHtml = await home.text()
check(
  'public / still serves its prerendered content',
  home.status === 200 && homeHtml.includes('data-hero="true"'),
  String(home.status),
)

let failed = false
for (const [label, passed, detail] of results) {
  if (!passed) failed = true
  console.info(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}
process.exitCode = failed ? 1 : 0
