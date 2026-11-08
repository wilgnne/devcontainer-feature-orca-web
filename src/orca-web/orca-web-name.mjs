import { basename, resolve } from 'node:path';
import { createRequire } from 'node:module';

// Use Orca's own RPC client so changes are persisted through the running server.
// Clear inherited routing to avoid updating the Orca that launched this terminal.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('ORCA_')) delete process.env[key];
}
const profile = resolve(process.argv[2]);
const machineName = basename(resolve(process.argv[3]));
if (!machineName || machineName.length > 255) throw new Error('Invalid project name.');
process.env.ORCA_USER_DATA_PATH = profile;
const require = createRequire(import.meta.url);
const { RuntimeClient } = require('/opt/orca-web/resources/app.asar.unpacked/out/cli/runtime-client.js');
const client = new RuntimeClient(profile, 15000, null, null);
const update = await client.call('settings.update', { machineName });
if (!update.ok) throw new Error('Orca rejected the machine name update.');
const result = await client.call('settings.get', null);
if (result.result?.settings?.machineName !== machineName) throw new Error('Orca machine name was not applied.');
console.log(`Orca machine name: ${machineName}`);
