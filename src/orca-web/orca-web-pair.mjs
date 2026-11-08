import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Pairing remains Orca's native flow. Only translate its loopback endpoint to
// the Coder application's HTTPS origin; keep the credential in a URL fragment.
export function pairingURL(origin, logPath = join(homedir(), '.local/share/homeprod-orca-web/server.log')) {
  const app = new URL(origin);
  if (app.protocol !== 'https:' && !(app.protocol === 'http:' && app.hostname === '127.0.0.1')) {
    throw new Error('Use the HTTPS URL of the Coder app (or HTTP loopback for local tests).');
  }
  const lines = readFileSync(logPath, 'utf8').split('\n');
  const ready = lines.flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }).findLast(entry => entry.type === 'orca_server_ready');
  if (!ready?.pairing?.available || !ready.pairing.url) {
    throw new Error('No pairing offer is available. Start Orca Web and inspect its local log.');
  }
  const pairing = new URL(ready.pairing.url);
  const offer = JSON.parse(Buffer.from(pairing.searchParams.get('code'), 'base64url').toString());
  offer.endpoint = app.origin.replace(/^http/, 'ws');
  const code = Buffer.from(JSON.stringify(offer)).toString('base64url');
  const browser = new URL('/web-index.html', app.origin);
  browser.hash = new URLSearchParams({ pairing: code }).toString();
  return browser.href;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(pairingURL(process.argv[2]));
}
