import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startFixtureServer } from './preview.mjs';
import { createFixture } from './fixture.mjs';

const directory = await mkdtemp(join(tmpdir(), 'dilemma-site-browser-'));
const profile = join(directory, 'chrome-profile');
const chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-default-apps',
  '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
let chromeError;
chrome.on('error', error => { chromeError = error; });
const { server, control, url } = await startFixtureServer();
let socket;
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (chromeError) throw chromeError;
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await delay(100); }
  }
  assert.ok(port, 'Chrome debugger starts');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (!message.id) return;
    const job = pending.get(message.id);
    if (!job) return;
    pending.delete(message.id);
    clearTimeout(job.timeout);
    message.error ? job.reject(new Error(message.error.message)) : job.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await delay(100); }
    throw new Error(`Browser condition not reached: ${expression}`);
  };
  const reload = async () => { await send('Page.reload'); await until("document.querySelector('#completed-count')?.textContent === '12'"); };
  await send('Runtime.enable');
  await send('Page.enable');
  await until("document.querySelector('#completed-count')?.textContent === '12'");
  for (const [name, width, height] of [['mobile', 390, 844], ['desktop', 1280, 1000]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
    await delay(150);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${name} has no horizontal overflow`);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#fixture-banner')).display !== 'none'"), true);
    assert.equal(await evaluate("document.querySelector('#result-link').hidden"), true, 'fixture never offers synthetic result transaction as evidence');
    const metrics = await send('Page.getLayoutMetrics');
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: metrics.cssContentSize.height, scale: 1 } });
    await writeFile(join(directory, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  assert.match(await evaluate("document.querySelector('#roster-summary').textContent"), /3 agents · 2 vs 1/);
  assert.equal(await evaluate("document.querySelector('#phase-count').textContent"), '2 / 3');
  assert.equal(await evaluate("document.querySelector('#cancelled-count').textContent"), '1');
  assert.equal(await evaluate("document.querySelectorAll('.agent-card').length"), 3);
  assert.match(await evaluate("document.querySelector('#hermes-members').textContent"), /individual plans/);

  control.state.current_game.phase = 'reveal';
  control.state.current_game.revealed_count = 1;
  control.state.messages.openclaw[0].message = '<img src=x onerror="window.injected=true"> literal agent text';
  control.state.messages.openclaw.push({ ...control.state.messages.hermes[0], message: 'Wrong-team message must be excluded' });
  control.state.links.telegram.openclaw = 'https://evil.test/invite';
  control.state.links.telegram.hermes = 'https://t.me/+syntheticInvite';
  await reload();
  assert.equal(await evaluate("document.querySelector('#phase-count').textContent"), '1 / 2');
  assert.equal(await evaluate("document.querySelector('#messages-openclaw img') === null && !window.injected"), true);
  assert.match(await evaluate("document.querySelector('#messages-openclaw').textContent"), /<img src=x/);
  assert.doesNotMatch(await evaluate("document.querySelector('#messages-openclaw').textContent"), /Wrong-team/);
  assert.equal(await evaluate("document.querySelector('#telegram-openclaw').hasAttribute('href')"), false);
  assert.equal(await evaluate("document.querySelector('#telegram-hermes').href"), 'https://t.me/+syntheticInvite');

  control.state.status = 'intermission';
  control.state.next_game_at = new Date(Date.now() + 20_000).toISOString();
  await reload();
  assert.equal(await evaluate("document.querySelector('#current-title').textContent"), 'Next game starting');
  assert.match(await evaluate("document.querySelector('#result-title').textContent"), /103.*Completed/);

  control.fail = true;
  await until("document.querySelector('#connection').dataset.state === 'error'");
  assert.equal(await evaluate("document.querySelector('#completed-count').textContent"), '12', 'network error preserves known counts');
  assert.equal(await evaluate("document.querySelector('#next-game').textContent"), '', 'network error stops speculative next-game countdown');

  control.fail = false;
  control.state = createFixture(Date.now() - 30_000);
  await reload();
  assert.equal(await evaluate("document.querySelector('#connection').dataset.state"), 'stale');
  control.state = createFixture();
  control.state.roster.push({ seat_id: 'hs-2', team: 'hermes', harness: 'hermes', wallet_address: '0x' + '4'.repeat(40) });
  await reload();
  assert.match(await evaluate("document.querySelector('#roster-summary').textContent"), /4 agents · 2 vs 2/);

  // This in-memory fixture exercises the live-mode renderer only. It is not saved as live evidence.
  control.state.mode = 'live';
  await reload();
  assert.equal(await evaluate("document.querySelector('#result-link').href"), control.state.latest_result.transaction_url);
  assert.equal(await evaluate("document.querySelector('#result-link').hidden"), false);
  assert.deepEqual(errors, [], 'no browser runtime exceptions');
  console.log(`Browser checks passed. Synthetic screenshots: ${directory}/mobile.png and ${directory}/desktop.png`);
} finally {
  socket?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  chrome.kill('SIGTERM');
  await delay(400);
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
