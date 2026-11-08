#!/usr/bin/env bash
set -euo pipefail
umask 077

script=$(realpath "${BASH_SOURCE[0]}")
export ORCA_WEB_PROJECT_ROOT="${ORCA_WEB_PROJECT_ROOT:-$PWD}"
project="$ORCA_WEB_PROJECT_ROOT"
state="$HOME/.local/share/homeprod-orca-web"
port=6770
backend_port=6771

# The persistent volume is initially root-owned. Change only its mount point.
if [[ ! -d "$state" || ! -w "$state" ]]; then
  sudo -n install -d -m 700 -o "$(id -u)" -g "$(id -g)" "$state"
fi
mkdir -p "$state/profile"
chmod 700 "$state" "$state/profile"

running() {
  [[ -f "$state/service.lock" ]] && ! flock -n "$state/service.lock" true
}

select_profile() {
  while read -r variable; do unset "$variable"; done < <(compgen -v ORCA_)
  export ORCA_USER_DATA_PATH="$state/profile"
  export ORCA_SERVE_USER_DATA_PATH="$state/profile"
  export ORCA_CLI_BIN_DIR="$state/profile/cli/bin"
}

case "${1:-status}" in
  start)
    # Serialize lifecycle hooks so a concurrent start cannot truncate the log
    # containing the running server's pairing offer.
    exec 8>"$state/start.lock"
    flock 8
    if running; then
      node "$(dirname "$script")/orca-web-name.mjs" "$state/profile" "$project"
      bash "$script" cli repo add --path "$project" --json >/dev/null
      echo 'Orca Web is already running on port 6770.'
      exit 0
    fi
    [[ -x /opt/homeprod-orca/AppRun ]] || {
      echo 'Orca is not installed. Rebuild the devcontainer.' >&2; exit 1;
    }
    # A detached session survives the end of the devcontainer lifecycle hook.
    setsid --fork bash "$script" run </dev/null >"$state/server.log" 2>&1 8>&-
    for ((attempt=0; attempt<90; attempt++)); do
      if running && curl -fs --max-time 1 "http://127.0.0.1:$backend_port/" -o /dev/null && \
          curl -fs --max-time 1 "http://127.0.0.1:6772/__orca/pairing" -o /dev/null; then
        node "$(dirname "$script")/orca-web-name.mjs" "$state/profile" "$project"
        bash "$script" cli repo add --path "$project" --json >/dev/null
        echo 'Orca Web ready on port 6770. Open its Coder app; see .devcontainer/README.md for pairing.'
        exit 0
      fi
      sleep 1
    done
    echo "Orca Web did not become ready. Inspect $state/server.log locally (contains pairing credentials)." >&2
    exit 1
    ;;
  run)
    exec 9>"$state/service.lock"
    flock -n 9 || exit 0
    printf '%s\n' "$$" > "$state/service.pid"
    trap 'rm -f "$state/service.pid"' EXIT
    # A terminal launched by another Orca inherits its routing and identity.
    # This server must have its own profile and must not attach to that runtime.
    select_profile
    node "$(dirname "$script")/orca-web-lock.mjs" "$state/profile"
    export LIBGL_ALWAYS_SOFTWARE=1
    # Local projects only: use Orca's bundled Node runtime rather than nested SSH.
    export ORCA_SERVE_RUNTIME=orcad
    cd "$project"
    node "$(dirname "$script")/orca-web-gateway.mjs" 9>&- &
    gateway=$!
    dbus-run-session -- /opt/homeprod-orca/AppRun --no-sandbox \
      "--user-data-dir=$state/profile" serve --port "$backend_port" --bind 127.0.0.1 \
      --pairing-address 127.0.0.1 --project-root "$project" --json 9>&- &
    child=$!
    cleanup() {
      kill -TERM "$child" "$gateway" 2>/dev/null || true
      rm -f "$state/service.pid"
    }
    trap cleanup EXIT
    trap 'exit 0' TERM INT
    wait -n "$child" "$gateway"
    ;;
  stop)
    if running && [[ -f "$state/service.pid" ]]; then
      pid=$(cat "$state/service.pid")
      [[ "$pid" =~ ^[0-9]+$ ]] || exit 1
      kill -TERM -- "-$pid"
      for ((attempt=0; attempt<50; attempt++)); do
        if ! running; then
          echo 'Orca Web is stopped.'
          exit 0
        fi
        sleep 0.2
      done
      echo 'Orca Web has not stopped yet. Inspect its local log before restarting.' >&2
      exit 1
    else
      echo 'Orca Web is stopped.'
    fi
    ;;
  status)
    if running; then
      curl -fsS --max-time 3 "http://127.0.0.1:6772/__orca/pairing" -o /dev/null
      curl -fsS --max-time 3 "http://127.0.0.1:$backend_port/" -o /dev/null
      echo 'Orca Web is running on port 6770.'
    else
      echo 'Orca Web is stopped.'; exit 1
    fi
    ;;
  pair)
    exec node "$(dirname "$script")/orca-web-pair.mjs" "${2:?Pass the HTTPS URL opened by the Coder Orca app}"
    ;;
  cli)
    shift
    select_profile
    exec /opt/homeprod-orca/resources/bin/orca-ide "$@"
    ;;
  *) echo "Usage: bash $script {start|stop|status|pair HTTPS_APP_URL|cli COMMAND...}" >&2; exit 2 ;;
esac
