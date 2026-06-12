import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const LOOPS_API = 'https://loops-api-rdb.vercel.app'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/functions\/v1\/loops-proxy/, '')

  try {
    if (path.startsWith('/challenge')) {
      const target = new URL(`${LOOPS_API}/challenge`)
      url.searchParams.forEach((v, k) => target.searchParams.set(k, v))
      const resp = await fetch(target.toString())
      const data = await resp.json()
      return new Response(JSON.stringify(data), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (path.startsWith('/download/')) {
      const id = path.replace('/download/', '')
      const target = `${LOOPS_API}/download/${id}`
      const resp = await fetch(target)
      const blob = await resp.blob()
      return new Response(blob, {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': resp.headers.get('Content-Type') || 'audio/mpeg',
        },
      })
    }

    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
