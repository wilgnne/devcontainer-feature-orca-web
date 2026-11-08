import { readFileSync, renameSync } from 'node:fs';
import { hostname } from 'node:os';
import { execFileSync } from 'node:child_process';

// Called only while holding the persistent service.lock. Recover a lock from a
// removed Docker container only when this Docker daemon also owns our container.
// Unknown hosts, unavailable Docker and existing containers are left to Orca.
export function recoverRemovedContainerLock(profile) {
  const path = `${profile}/orcad.lock`;
  let lock;
  try { lock = JSON.parse(readFileSync(path, 'utf8')); } catch { return; }
  if (!/^[a-f0-9]{12,64}$/.test(lock.host) || lock.host === hostname()) return;
  let containers;
  try {
    containers = execFileSync('docker', ['container', 'ls', '-a', '--no-trunc', '--format', '{{.ID}}'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n');
  } catch { return; }
  if (!containers.some(id => id.startsWith(hostname()))) return;
  if (containers.some(id => id.startsWith(lock.host))) return;
  renameSync(path, `${path}.removed-container-${Date.now()}`);
  console.error('Recovered Orca lock from a removed Docker container (backup preserved).');
}

recoverRemovedContainerLock(process.argv[2]);
