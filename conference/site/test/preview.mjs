import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createFixture } from './fixture.mjs';

export async function startFixtureServer({ port = 0 } = {}) {
  const control = { state: createFixture(), fail: false };
  const assets = new Map([['/', ['index.html', 'text/html']], ['/styles.css', ['styles.css', 'text/css']], ['/app.mjs', ['app.mjs', 'text/javascript']], ['/state.mjs', ['state.mjs', 'text/javascript']]]);
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/api/state') {
      response.writeHead(control.fail ? 503 : 200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(control.fail ? { error: 'synthetic outage' } : control.state));
      return;
    }
    const asset = assets.get(request.url);
    if (!asset) { response.writeHead(404); response.end(); return; }
    try {
      const data = await readFile(new URL(`../${asset[0]}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': asset[1] });
      response.end(data);
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, control, url: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const preview = await startFixtureServer({ port: Number(process.env.PORT ?? 4173) });
  const timer = setInterval(() => { preview.control.state.updated_at = new Date().toISOString(); }, 5000);
  console.log(`Synthetic fixture preview only: ${preview.url}`);
  process.on('SIGINT', () => { clearInterval(timer); preview.server.close(); });
}
