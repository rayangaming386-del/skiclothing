// Mini-gateway (zoals Kong in Supabase): /auth/v1 → GoTrue, /rest/v1 → PostgREST,
// /functions/v1/* → Edge Function (Deno), /templates/* → e-mailtemplates.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const TEMPLATES = process.env.TEMPLATES_DIR;
const routes = [
  ['/auth/v1', 9999],
  ['/rest/v1', 3000],
  ['/functions/v1', 8000],
];

http
  .createServer((req, res) => {
    // CORS zoals de Supabase API-gateway (nodig voor de web-variant van de app in tests)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type, prefer, accept-profile, content-profile, x-supabase-api-version, range');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'content-range, x-total-count');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    if (req.url.startsWith('/templates/')) {
      const file = path.join(TEMPLATES, path.basename(req.url));
      if (!fs.existsSync(file)) return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': 'text/html' });
      return fs.createReadStream(file).pipe(res);
    }
    const r = routes.find(([p]) => req.url.startsWith(p + '/') || req.url === p);
    if (!r) return res.writeHead(404).end('no route');
    const upstream = http.request(
      { host: '127.0.0.1', port: r[1], path: req.url.slice(r[0].length) || '/', method: req.method, headers: { ...req.headers, host: `127.0.0.1:${r[1]}` } },
      (up) => {
        const headers = Object.fromEntries(Object.entries(up.headers).filter(([k]) => !k.startsWith('access-control-')));
        res.writeHead(up.statusCode ?? 502, headers);
        up.pipe(res);
      },
    );
    upstream.on('error', (e) => res.writeHead(502).end(String(e)));
    req.pipe(upstream);
  })
  .listen(PORT, '127.0.0.1', () => console.log(`gateway op ${PORT}`));
