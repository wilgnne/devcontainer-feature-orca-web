#!/usr/bin/env bash
set -euo pipefail
user=$(cat /etc/orca-web-user)
state=/var/lib/orca-web
init=/usr/local/lib/orca-web/orca-web-init.sh

# The image has no sudo, even when the upstream image provided it.
! command -v sudo
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
runuser -u "$user" -- env HOME="$home" bash <<'USER_TEST'
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
# Starting twice must preserve the existing process/offer.
orca-web start
orca-web stop
USER_TEST
printf 'User, primary group, fresh/reused volume, UID/GID migration, startup and pairing passed: %s\n' "$user"
