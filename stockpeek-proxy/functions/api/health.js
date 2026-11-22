export function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, service: 'stockpeek-proxy', mode: 'restricted' }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}
export function onRequest() {
  return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET' } })
}
