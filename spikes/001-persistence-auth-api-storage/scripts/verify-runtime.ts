export {}

const baseUrl = process.env.SPIKE_BASE_URL ?? 'http://127.0.0.1:3011'
const email = `runtime-${crypto.randomUUID()}@example.test`
const signup = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
  body: JSON.stringify({
    email,
    name: 'Runtime spike user',
    password: 'correct horse battery staple',
  }),
  headers: { 'content-type': 'application/json' },
  method: 'POST',
})
if (signup.status !== 200) throw new Error(`Sign-up failed: ${signup.status}`)

const setCookie = signup.headers.get('set-cookie')
if (!setCookie) throw new Error('No session cookie was issued')
const cookie = setCookie.split(';', 1)[0]

const anonymous = await fetch(`${baseUrl}/app`)
if (anonymous.status < 400) {
  throw new Error(`Anonymous /app unexpectedly returned ${anonymous.status}`)
}

const authenticated = await fetch(`${baseUrl}/app`, {
  headers: { cookie },
})
const body = await authenticated.text()
const renderedAuthenticatedEmail = body.includes(email)
const authenticatedStatus = Number(authenticated.status)
if (authenticatedStatus !== 200 || !renderedAuthenticatedEmail) {
  throw new Error(
    `Authenticated /app failed: ${authenticated.status}; email present=${body.includes(email)}`,
  )
}

console.log(
  JSON.stringify({
    anonymousStatus: anonymous.status,
    authenticatedStatus,
    authenticatedEmailRendered: true,
    sessionCreatedOverHttp: true,
  }),
)
