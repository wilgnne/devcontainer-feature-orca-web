#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# Features install as root; use the effective remote user, not the build user.
remote_user=$(id -un "${_REMOTE_USER:-${_CONTAINER_USER:-root}}")
remote_uid=$(id -u "$remote_user")
remote_gid=$(id -g "$remote_user")
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl dbus dbus-user-session nodejs procps util-linux xvfb \
    libgtk-3-0t64 libpango-1.0-0 libcairo2 libnss3 libgbm1 libdrm2 \
    libasound2t64 libcups2t64 libxkbcommon0 libatk1.0-0t64 \
    libatk-bridge2.0-0t64 libatspi2.0-0t64 libx11-xcb1 libxcb-dri3-0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxrender1 libxss1 libxtst6 \
    && rm -rf /var/lib/apt/lists/*

bash ./install-orca.sh "${VERSION:-v1.4.253}" /opt/orca-web
install -d -m 755 /usr/local/lib/orca-web
install -d -m 755 /usr/local/lib/orca-web/vendor
install -m 644 vendor/qrcode.js /usr/local/lib/orca-web/vendor/qrcode.js
install -m 755 orca-web.sh /usr/local/lib/orca-web/orca-web.sh
install -m 644 orca-web-gateway.mjs orca-web-pair.mjs orca-web-lock.mjs orca-web-name.mjs orca-web-desktop.html /usr/local/lib/orca-web/
ln -sf /usr/local/lib/orca-web/orca-web.sh /usr/local/bin/orca-web
install -d -m 755 /etc/profile.d
install -m 644 orca-web-coder-profile.sh /etc/profile.d/orca-web-coder.sh

# Docker seeds new volumes from this directory. The entrypoint repairs reused
# volumes after Dev Containers changes the remote user's UID/GID.
printf '%s\n' "$remote_user" > /etc/orca-web-user
chmod 644 /etc/orca-web-user
install -m 755 orca-web-init.sh /usr/local/lib/orca-web/orca-web-init.sh
install -d -m 700 -o "$remote_uid" -g "$remote_gid" /var/lib/orca-web
