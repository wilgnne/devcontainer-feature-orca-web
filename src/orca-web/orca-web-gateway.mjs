import http from 'node:http';
import { basename, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { pairingURL } from './orca-web-pair.mjs';

export function createGateway({ backendPort = 6771, logPath, privatePairing = false, projectRoot = process.env.ORCA_WEB_PROJECT_ROOT || process.cwd() } = {}) {
  const desktopPage = () => readFileSync(new URL('./orca-web-desktop.html', import.meta.url), 'utf8')
    .replace('__ORCA_AGENT_NAME_JSON__', JSON.stringify(basename(resolve(projectRoot))).replaceAll('<', '\\u003c'));
  const server = http.createServer((req, res) => {
    const requestedPath = req.url?.split('?')[0];
    // Existing Coder app registrations prepend their configured /__orca/desktop base path.
    let path = requestedPath;
    if (privatePairing && path?.startsWith('/__orca/desktop/')) {
      path = path.slice('/__orca/desktop'.length);
      if (path === '/') path = '/__orca/desktop';
    }
    let normalized;
    try { normalized = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400).end(); return; }
    if (!privatePairing && normalized.startsWith('/__orca')) {
      res.writeHead(404, { 'Cache-Control': 'no-store' }).end(); return;
    }
    if (privatePairing && ['/', '/__orca/pairing', '/__orca/desktop', '/__orca/qrcode.js'].includes(path)) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      // Do not allow another site to read pairing credentials, even on loopback.
      let foreignOrigin = false;
      try {
        foreignOrigin = Boolean(req.headers.origin && new URL(req.headers.origin).host !== req.headers.host);
      } catch { foreignOrigin = true; }
      if (path === '/__orca/pairing' &&
          (req.headers['sec-fetch-site'] === 'cross-site' || foreignOrigin)) {
        res.writeHead(403).end();
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      if (path === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : desktopPage());
        return;
      }
      if (path === '/__orca/desktop' || path === '/__orca/qrcode.js') {
        const qr = path === '/__orca/qrcode.js';
        const body = qr ? readFileSync(new URL('./vendor/qrcode.js', import.meta.url)) : desktopPage();
        res.writeHead(200, { 'Content-Type': qr ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      try {
        // Use a fixed loopback origin here. Only the page constructs the public
        // endpoint, from location.origin, after receiving the native offer.
        const url = new URL(pairingURL('http://127.0.0.1', logPath));
        const code = new URLSearchParams(url.hash.slice(1)).get('pairing');
        const offer = Buffer.from(code, 'base64url');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(req.method === 'HEAD' ? undefined : offer);
      } catch {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Orca pairing is not available.');
      }
      return;
    }
    if (privatePairing) { res.writeHead(404).end(); return; }
    const upstream = http.request({ hostname: '127.0.0.1', port: backendPort,
      path: req.url, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });

  server.on('upgrade', (req, socket, head) => {
    if (privatePairing) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    const upstream = http.request({ hostname: '127.0.0.1', port: backendPort,
      path: req.url, method: req.method, headers: req.headers });
    upstream.on('upgrade', (response, peer, peerHead) => {
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`);
      for (let i = 0; i < response.rawHeaders.length; i += 2) {
        socket.write(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`);
      }
      socket.write('\r\n');
      if (peerHead.length) socket.write(peerHead);
      if (head.length) peer.write(head);
      socket.pipe(peer).pipe(socket);
      socket.on('error', () => peer.destroy());
      peer.on('error', () => socket.destroy());
      socket.on('close', () => peer.destroy());
      peer.on('close', () => socket.destroy());
    });
    upstream.on('response', response => { response.resume(); socket.destroy(); });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    upstream.end();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createGateway().listen(6770, '127.0.0.1');
  createGateway({ privatePairing: true }).listen(6772, '127.0.0.1');
}
