function unavailable(status, message) {
  return Response.json({ detail: message }, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
      'Cloudflare-CDN-Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export async function handleRequest(request, env, upstreamFetch = fetch) {
  const url = new URL(request.url)
  if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
    return env.ASSETS.fetch(request)
  }

  let upstream
  try {
    upstream = new URL(env.API_UPSTREAM_ORIGIN)
    if (upstream.protocol !== 'https:' || upstream.origin === url.origin ||
        upstream.pathname !== '/' || upstream.search || upstream.hash ||
        upstream.username || upstream.password) {
      throw new Error('Invalid upstream configuration.')
    }
  } catch {
    return unavailable(503, 'The API connection is not configured.')
  }

  const target = new URL(url.pathname + url.search, upstream)
  const headers = new Headers(request.headers)
  headers.delete('Host')
  headers.set('X-Forwarded-Proto', 'https')
  headers.set('X-Forwarded-Host', url.host)
  const forwarded = new Request(target, new Request(request, {
    headers,
    redirect: 'manual',
  }))

  let response
  try {
    response = await upstreamFetch(forwarded, {
      cache: 'no-store',
      cf: { cacheTtlByStatus: { '100-599': -1 }, cacheEverything: false },
    })
  } catch {
    return unavailable(502, 'The API connection is temporarily unavailable.')
  }

  // Cloning the Headers preserves each Set-Cookie field, including cookies
  // containing comma-separated expiry dates. Never join or split cookies.
  const responseHeaders = new Headers(response.headers)
  responseHeaders.set('Cache-Control', 'no-store')
  responseHeaders.set('CDN-Cache-Control', 'no-store')
  responseHeaders.set('Cloudflare-CDN-Cache-Control', 'no-store')
  const location = responseHeaders.get('Location')
  if (location) {
    const redirect = new URL(location, target)
    if (redirect.origin === upstream.origin) {
      responseHeaders.set('Location', url.origin + redirect.pathname + redirect.search + redirect.hash)
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

export default { fetch: (request, env) => handleRequest(request, env) }
