import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createGateway } from './orca-web-gateway.mjs';

async function fixture(t, { privatePairing = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-gateway-'));
  const logPath = join(dir, 'server.log');
  const offer = { v: 2, endpoint: 'ws://127.0.0.1:6771', deviceToken: 'test-only', hostDescriptor: { name: 'máquina' } };
  const ready = token => JSON.stringify({ type: 'orca_server_ready', pairing: { available: true,
    url: `http://127.0.0.1/?code=${Buffer.from(JSON.stringify({ ...offer, deviceToken: token })).toString('base64url')}` } });
  writeFileSync(logPath, `startup\n${ready('obsolete')}\n${ready('test-only')}\n`);
  const backend = http.createServer((req, res) => { res.setHeader('X-Backend', 'orca'); req.pipe(res); });
  backend.on('upgrade', (req, socket, head) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    if (head.length) socket.write(head);
    socket.on('data', data => socket.write(data));
    socket.on('end', () => socket.destroy());
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const gateway = createGateway({ backendPort: backend.address().port, logPath, privatePairing, projectRoot: '/workspaces/orca-web' });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  t.after(() => { gateway.closeAllConnections(); gateway.close(); backend.closeAllConnections(); backend.close(); rmSync(dir, { recursive: true }); });
  return { base: `http://127.0.0.1:${gateway.address().port}`, logPath };
}

test('public gateway never serves the pairing API or private page, including encoded paths', async t => {
  const { base } = await fixture(t, { privatePairing: false });
  for (const path of ['/__orca/pairing', '/__orca/desktop', '/__orca/qrcode.js', '/%5f%5forca/pairing', '/__orca%2fpairing']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), '');
  }
  const response = await fetch(base);
  assert.equal(response.headers.get('x-backend'), 'orca');
  assert.doesNotMatch(await response.text(), /test-only|pairing|deviceToken/);
});

test('private pairing gateway does not proxy backend HTTP routes', async t => {
  const { base } = await fixture(t);
  assert.equal((await fetch(base + '/api/example')).status, 404);
});

test('pairing rejects foreign origins, invalid origins, cross-site fetches and writes', async t => {
  const { base } = await fixture(t);
  for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await fetch(base + '/__orca/pairing', { headers })).status, 403);
  }
  assert.equal((await fetch(base + '/__orca/pairing', { method: 'POST' })).status, 405);
  const response = await fetch(base + '/__orca/pairing');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('unavailable offer returns a sanitized error', async t => {
  const { base, logPath } = await fixture(t);
  const log = JSON.stringify({ type: 'orca_server_ready', pairing: { available: false } });
  writeFileSync(logPath, log);
  const response = await fetch(base + '/__orca/pairing');
  assert.equal(response.status, 503);
  assert.equal(await response.text(), 'Orca pairing is not available.');
});

test('HTTP methods, paths and bodies reach the Orca backend', async t => {
  const { base } = await fixture(t, { privatePairing: false });
  const response = await fetch(base + '/api/example?x=1', { method: 'POST', body: 'payload' });
  assert.equal(response.headers.get('x-backend'), 'orca');
  assert.equal(await response.text(), 'payload');
});

test('WebSocket upgrades and bidirectional traffic pass through the gateway', { timeout: 5000 }, async t => {
  const { base } = await fixture(t, { privatePairing: false });
  await new Promise((resolve, reject) => {
    const req = http.request(base + '/socket', { headers: { Connection: 'Upgrade', Upgrade: 'websocket' } });
    req.on('error', reject);
    req.on('upgrade', (response, socket) => {
      assert.equal(response.statusCode, 101);
      socket.on('error', reject);
      socket.once('data', data => { assert.equal(data.toString(), 'test-frame'); socket.destroy(); resolve(); });
      socket.write('test-frame');
    });
    req.end();
  });
});

async function desktop(t, { clipboardFails = false, unavailable = false, origin = 'https://orca-pair--workspace.coder.example' } = {}) {
  const { base, logPath } = await fixture(t);
  if (unavailable) writeFileSync(logPath, '');
  const response = await fetch(base + '/__orca/desktop');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
  const html = await response.text();
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: true, disabled: false,
      addEventListener(event, listener) { this[event] = listener; },
      removeAttribute(name) { delete this[name]; }, replaceChildren() { this.innerHTML = ''; }, focus() { this.focused = true; }, select() { this.selected = true; } });
    return elements.get(id);
  };
  element('public-url').value = 'https://92f01roc-orca--orca-web--developer.coder.example.test';
  let copied;
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, btoa, URLSearchParams, URL,
    location: { origin },
    document: { getElementById: element },
    navigator: { clipboard: { async writeText(text) { if (clipboardFails) throw new Error(); copied = text; } } },
    fetch: path => fetch(base + path) });
  const asset = await fetch(base + '/__orca/qrcode.js');
  assert.equal(asset.status, 200);
  vm.runInContext(await asset.text(), context);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/initialize\(\);\s*$/, '');
  vm.runInContext(script, context);
  await vm.runInContext('load()', context);
  return { base, element, copied: () => copied };
}

test('desktop produces a native URL and local QR, copies the same offer and can refresh', async t => {
  const { element, copied } = await desktop(t);
  const url = new URL(element('url').value);
  assert.equal(url.protocol, 'orca:'); assert.equal(url.hostname, 'pair');
  const offer = JSON.parse(Buffer.from(url.searchParams.get('code'), 'base64url'));
  assert.equal(offer.endpoint, 'wss://92f01roc-orca--orca-web--developer.coder.example.test');
  assert.equal(offer.deviceToken, 'test-only');
  assert.equal(offer.hostDescriptor.name, 'máquina');
  assert.match(element('qr').innerHTML, /<svg/);
  assert.equal(element('qr').hidden, false);
  assert.ok(element('web').href.startsWith('https://92f01roc-orca--orca-web--developer.coder.example.test/web-index.html#pairing='));
  await element('copy').click();
  assert.equal(copied(), element('url').value);
  const previous = element('url').value;
  await element('reload').click();
  assert.equal(element('url').value, previous);
});

test('desktop selects URL for manual copying when clipboard is unavailable', async t => {
  const { element } = await desktop(t, { clipboardFails: true });
  await element('copy').click();
  assert.equal(element('url').selected, true);
  assert.match(element('status').textContent, /Ctrl\+C/);
});

test('desktop clears credentials and QR when pairing is unavailable', async t => {
  const { base, element } = await desktop(t, { unavailable: true });
  assert.equal(element('url').value, '');
  assert.equal(element('copy').disabled, true);
  assert.equal(element('qr').hidden, true);
  assert.match(element('status').textContent, /Não foi possível/);
  for (const path of ['/__orca/desktop', '/__orca/qrcode.js']) {
    assert.equal((await fetch(base + path, { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(base + path, { method: 'POST' })).status, 405);
  }
});

test('private gateway refuses WebSocket upgrades', async t => {
  const { base } = await fixture(t);
  await new Promise((resolve, reject) => {
    const request = http.request(base + '/socket', { headers: { Connection: 'Upgrade', Upgrade: 'websocket' } });
    request.on('upgrade', (_, socket) => { socket.destroy(); reject(new Error('Private WebSocket exposed')); });
    request.on('response', response => { response.resume(); assert.equal(response.statusCode, 404); resolve(); });
    request.on('error', reject);
    request.end();
  });
});

for (const path of ['/', '/__orca/desktop/']) {
  test(`private page accepts Coder entry path ${path}`, async t => {
    const { base } = await fixture(t);
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Parear Orca Desktop/);
  });
}

test('desktop uses the supplied public address independently of the pairing domain', async t => {
  const { element } = await desktop(t, { origin: 'https://330ol4ul-orca-pair--orca-web--developer.coder.example.test' });
  const url = new URL(element('url').value);
  const offer = JSON.parse(Buffer.from(url.searchParams.get('code'), 'base64url'));
  assert.equal(offer.endpoint, 'wss://92f01roc-orca--orca-web--developer.coder.example.test');
});

 test('existing Coder app base path serves pairing API and QR script', async t => {
  const { base } = await fixture(t);
  const response = await fetch(base + '/__orca/desktop/__orca/pairing');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deviceToken, 'test-only');
  const asset = await fetch(base + '/__orca/desktop/__orca/qrcode.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(base + '/__orca/desktop/api/example')).status, 404);
  assert.equal((await fetch(base + '/__orca/desktop/__orca/pairing', {headers: {origin: 'https://evil.example'}})).status, 403);
});

test('submitting another public URL updates the offer and rejects invalid addresses', async t => {
  const { element } = await desktop(t);
  element('public-url').value = 'https://another-orca.example';
  element('public-url').input();
  assert.equal(element('url').value, '');
  await element('public-form').submit({ preventDefault() {} });
  const offer = JSON.parse(Buffer.from(new URL(element('url').value).searchParams.get('code'), 'base64url'));
  assert.equal(offer.endpoint, 'wss://another-orca.example');
  assert.ok(element('web').href.startsWith('https://another-orca.example/'));
  for (const value of ['http://orca.example', 'https://orca.example/path', 'https://user:pass@orca.example', 'invalid']) {
    element('public-url').value = value;
    await element('public-form').submit({ preventDefault() {} });
    assert.equal(element('url').value, '');
    assert.equal(element('copy').disabled, true);
    assert.match(element('status').textContent, /HTTPS válida/);
  }
});

test('Coder hash derives the correct public app URL and initializes the editable field', async t => {
  const { base } = await fixture(t);
  const html = await (await fetch(base)).text();
  assert.ok(!html.includes('__ORCA_AGENT_NAME_JSON__'));
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const functions = script.slice(0, script.indexOf('const status ='));
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, URL });
  vm.runInContext(functions, context);
  assert.equal(await vm.runInContext("coderAppURL('https://330ol4ul-orca-pair--orca-web--developer.coder.example.test', agentName, 'orca')", context),
    'https://92f01roc-orca--orca-web--developer.coder.example.test');
});
