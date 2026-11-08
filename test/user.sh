#!/usr/bin/env bash
set -euo pipefail
user=$(cat /etc/orca-web-user)
state=/var/lib/orca-web
init=/usr/local/lib/orca-web/orca-web-init.sh

# The image has no sudo, even when the upstream image provided it.
! command -v sudo
[[ -x /opt/orca-web/AppRun ]]
[[ -x /opt/orca-web/resources/bin/orca-ide ]]
[[ $(cat /opt/orca-web/orca-web-version) == v1.4.253 ]]
[[ $(stat -c '%u:%g' "$state") == "$(id -u "$user"):$(id -g "$user")" ]]

# A fresh Docker volume is seeded with the selected remote user's ownership.
runuser -u "$user" -- "$init"
runuser -u "$user" -- bash -c 'umask 077; mkdir -p /var/lib/orca-web/profile; printf preserved > /var/lib/orca-web/profile/preservation-test'

# Model a persistent volume from an old container/user identity. Non-root
# without sudo must fail explicitly, not silently erase or replace the profile.
chown -hR 32001:32002 "$state"
if [[ "$user" != root ]]; then
    if runuser -u "$user" -- "$init" 2>/tmp/init-error; then
        echo 'Expected failure for inaccessible volume without root initialization' >&2
        exit 1
    fi
    grep -q 'needs initialization as root' /tmp/init-error
    # Simulate updateRemoteUserUID and a different primary group name/GID.
    groupadd -g 23001 orca-runtime
    usermod -u 23002 -g orca-runtime "$user"
fi
"$init"
[[ $(stat -c '%u:%g' "$state/profile/preservation-test") == "$(id -u "$user"):$(id -g "$user")" ]]
[[ $(cat "$state/profile/preservation-test") == preserved ]]
[[ $(stat -c '%a' "$state") == 700 ]]

mkdir -p /tmp/orca-feature-project
chown "$(id -u "$user"):$(id -g "$user")" /tmp/orca-feature-project
home=$(getent passwd "$user" | cut -d: -f6)
test_script=$(mktemp /tmp/orca-web-user-test.XXXXXX)
chmod 644 "$test_script"
trap 'rm -f "$test_script"' EXIT
cat > "$test_script" <<'USER_TEST'
set -euo pipefail
cd /tmp/orca-feature-project
git -c init.defaultBranch=main init -q
trap 'orca-web stop >/dev/null 2>&1 || true' EXIT
orca-web start
orca-web status
curl -fsS http://127.0.0.1:6770/ -o /dev/null
# The pairing module must read the neutral path, not $HOME.
orca-web pair https://orca.example.test | grep -q '^https://orca.example.test/web-index.html#pairing='
[[ $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6770/__orca/pairing) == 404 ]]
# A Coder login adopts ALL variables, including multiline values and shell
# metacharacters, without evaluating values or changing the project to HOME.
initial_pid=$(cat /var/lib/orca-web/service.pid)
export CODER=true
export GIT_SSH_COMMAND='/fake/coder gitssh --'
export CUSTOM_TEMPLATE_VALUE=$'line one\nline two: $(touch /tmp/orca-env-evaluated) "quotes"'
export CUSTOM_EMPTY_VALUE=''
(cd "$HOME"; . /etc/profile.d/orca-web-coder.sh; wait "$!")
[[ $(cat /var/lib/orca-web/service.pid) != "$initial_pid" ]]
[[ ! -e /tmp/orca-env-evaluated ]]
node <<'CHECK_ENV'
const fs = require('node:fs');
const assert = require('node:assert/strict');
const pid = fs.readFileSync('/var/lib/orca-web/service.pid', 'utf8').trim();
const entries = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
for (const name of ['GIT_SSH_COMMAND', 'CUSTOM_TEMPLATE_VALUE', 'CUSTOM_EMPTY_VALUE']) {
  assert(entries.includes(`${name}=${process.env[name]}`), `${name} was not inherited`);
}
assert.equal(fs.readFileSync('/var/lib/orca-web/project-root', 'utf8'), '/tmp/orca-feature-project\0');
CHECK_ENV
adopted_pid=$(cat /var/lib/orca-web/service.pid)
# Concurrent/repeated sessions cannot restart an already adopted server.
orca-web inherit-environment &
first=$!
orca-web inherit-environment &
second=$!
wait "$first" "$second"
[[ $(cat /var/lib/orca-web/service.pid) == "$adopted_pid" ]]
# Starting twice must preserve the existing process/offer.
orca-web start
orca-web stop
USER_TEST
runuser -u "$user" -- env HOME="$home" bash "$test_script" </dev/null
printf 'User, primary group, fresh/reused volume, UID/GID migration, startup and pairing passed: %s\n' "$user"
