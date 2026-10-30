// One canonical address: the project's own pages.dev host redirects to the custom domain (preview hosts like
// abc123.kaiav.pages.dev are left alone, so test deploys stay reachable).
export async function onRequest({ request, next }){
  const url = new URL(request.url);
  if (url.hostname === 'kaiav.pages.dev'){ url.hostname = 'kaiav.dev'; return Response.redirect(url.toString(), 301); }
  return next();
}
