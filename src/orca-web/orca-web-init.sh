#!/usr/bin/env bash
set -euo pipefail

# No environment-supplied path or owner is used by this root initialization.
state=/var/lib/orca-web
user=$(cat /etc/orca-web-user)
uid=$(id -u "$user")
gid=$(id -g "$user")

if [[ $(id -u) -eq 0 ]]; then
    [[ ! -L "$state" ]] || { echo 'Orca Web state directory must not be a symlink.' >&2; exit 1; }
    install -d -m 700 "$state"
    # Do not follow links in a persisted profile. Numeric IDs reflect runtime
    # UID/GID updates; the primary group need not have the same name as the user.
    chown -hR "$uid:$gid" "$state"
    chmod 700 "$state"
elif [[ $(stat -c '%u:%g' "$state") != "$uid:$gid" || ! -r "$state" || ! -w "$state" || ! -x "$state" ]]; then
    if command -v sudo >/dev/null && sudo -n true 2>/dev/null; then
        exec sudo -n /usr/local/lib/orca-web/orca-web-init.sh
    fi
    echo "Orca Web volume needs initialization as root: /usr/local/lib/orca-web/orca-web-init.sh (target user: $user)." >&2
    exit 1
fi
