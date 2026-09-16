import assert from 'node:assert/strict'
import test from 'node:test'
import { handleRequest } from './index.mjs'

const env = { API_UPSTREAM_ORIGIN: 'https://api.example.test' }

test('API proxy preserves requests, separate cookies, and streams uncached responses', async () => {
  const request = new Request('https://aralforge.com/api/auth/token/refresh/?schedule=3', {
    method: 'POST',
    headers: {
      Cookie: 'aralforge_refresh=credential; csrftoken=csrf-secret',
      Authorization: 'Bearer access-token',
      Origin: 'https://aralforge.com',
      'X-CSRFToken': 'csrf-secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ draft_revision: 2 }),
  })
  const cookies = [
    'aralforge_refresh=rotated; Expires=Wed, 16 Dec 2026 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/',
    'csrftoken=renewed; Secure; SameSite=Lax; Path=/',
  ]
  const response = await handleRequest(request, env, async (forwarded, options) => {
    assert.equal(forwarded.url, 'https://api.example.test/api/auth/token/refresh/?schedule=3')
    assert.equal(forwarded.method, 'POST')
    for (const key of ['Cookie', 'Authorization', 'Origin', 'X-CSRFToken', 'Content-Type']) {
      assert.equal(forwarded.headers.get(key), request.headers.get(key))
    }
    assert.equal(forwarded.headers.get('X-Forwarded-Proto'), 'https')
    assert.equal(forwarded.redirect, 'manual')
    assert.equal(options.cache, 'no-store')
    assert.deepEqual(options.cf, { cacheTtlByStatus: { '100-599': -1 }, cacheEverything: false })
    assert.deepEqual(await forwarded.json(), { draft_revision: 2 })
    const headers = new Headers({ 'Cache-Control': 'public, max-age=3600' })
    cookies.forEach(cookie => headers.append('Set-Cookie', cookie))
    return new Response(new Uint8Array([0, 1, 2, 255]), { headers })
  })
  assert.deepEqual(response.headers.getSetCookie(), cookies)
  for (const key of ['Cache-Control', 'CDN-Cache-Control', 'Cloudflare-CDN-Cache-Control']) {
    assert.equal(response.headers.get(key), 'no-store')
  }
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0, 1, 2, 255]))
})

test('multipart uploads reach the upstream without rebuilding their boundaries', async () => {
  const form = new FormData()
  form.append('activity', '12')
  form.append('file', new Blob(['student upload'], { type: 'text/plain' }), 'answer.txt')
  const request = new Request('https://aralforge.com/api/modules/submissions/', { method: 'POST', body: form })
  const response = await handleRequest(request, env, async forwarded => {
    assert.equal(forwarded.headers.get('Content-Type'), request.headers.get('Content-Type'))
    const received = await forwarded.formData()
    assert.equal(received.get('activity'), '12')
    assert.equal(await received.get('file').text(), 'student upload')
    return Response.json({ id: 12 }, { status: 201 })
  })
  assert.equal(response.status, 201)
})

test('upstream redirects stay on the frontend and are not automatically followed', async () => {
  for (const [location, expected] of [
    ['https://api.example.test/api/download/?ready=1', 'https://aralforge.com/api/download/?ready=1'],
    ['/api/download/?ready=1', 'https://aralforge.com/api/download/?ready=1'],
    ['https://storage.example.test/signed?key=123', 'https://storage.example.test/signed?key=123'],
  ]) {
    const response = await handleRequest(new Request('https://aralforge.com/api/download'), env, async forwarded => {
      assert.equal(forwarded.redirect, 'manual')
      return new Response(null, { status: 302, headers: { Location: location } })
    })
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('Location'), expected)
  }
})

test('navigation and static assets use the assets binding; API errors never use the SPA shell', async () => {
  for (const path of ['/modules/12', '/assets/index.js', '/api-other']) {
    const response = await handleRequest(new Request(`https://aralforge.com${path}`), {
      ASSETS: { fetch: async request => new Response(`asset:${new URL(request.url).pathname}`) },
    }, () => { throw new Error('Assets must not call the upstream.') })
    assert.equal(await response.text(), `asset:${path}`)
  }
  for (const API_UPSTREAM_ORIGIN of [undefined, 'http://api.example.test', 'https://aralforge.com', 'https://api.example.test/api']) {
    const response = await handleRequest(new Request('https://aralforge.com/api/health/'), { API_UPSTREAM_ORIGIN })
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
  }
})

test('upstream connection failure returns a recoverable uncached API error', async () => {
  const response = await handleRequest(new Request('https://aralforge.com/api/health/'), env, () => {
    throw new Error('Private upstream failure details')
  })
  assert.equal(response.status, 502)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(await response.json(), { detail: 'The API connection is temporarily unavailable.' })
})
