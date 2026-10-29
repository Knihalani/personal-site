// GET /api/where -> the visitor's approximate place, from Cloudflare's own IP geolocation (request.cf).
// Used by the terminal's `weather` with no city. Nothing is logged or stored; the IP never leaves Cloudflare.
export function onRequestGet({ request }){
  const cf = request.cf || {};
  const lat = parseFloat(cf.latitude), lon = parseFloat(cf.longitude);
  const body = isFinite(lat) && isFinite(lon)
    ? { name: cf.city || '', admin1: cf.region || '', country: cf.country || '', latitude: lat, longitude: lon, timezone: cf.timezone || '' }
    : {};
  return new Response(JSON.stringify(body), { headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  } });
}
