# Orca Web Dev Container Feature

Built for [Coder](https://coder.com): run Orca alongside your project in a dev container, open Orca Web from the workspace dashboard, and pair Orca Desktop through a private dashboard app. The feature installs Orca Web, a persistent profile, lifecycle commands and separate public and private pairing gateways.

## Using with Coder

Requires **Ubuntu 26.04** and x86_64 or arm64. The effective Dev Container `remoteUser` is detected automatically (`vscode`, `node`, a custom user, or `root`). The primary group is resolved independently of the username.

Add the feature and the dashboard apps to your project's `.devcontainer/devcontainer.json`. Merge these entries into any existing `features` and `customizations.coder.apps` configuration:

```json
{
  "name": "Orca Web",
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu26.04",
  "features": {
    "ghcr.io/wilgnne/devcontainer-feature-orca-web/orca-web:1": {
      "version": "v1.4.253"
    }
  },
  "customizations": {
    "coder": {
      "apps": [
        {
          "slug": "orca-pair",
          "displayName": "Pair Orca Desktop",
          "url": "http://localhost:6772",
          "subdomain": true,
          "share": "owner",
          "openIn": "tab"
        },
        {
          "slug": "orca",
          "displayName": "Orca Web",
          "url": "http://localhost:6770",
          "subdomain": true,
          "share": "public",
          "openIn": "tab",
          "healthCheck": {
            "url": "http://localhost:6770/",
            "interval": 10,
            "threshold": 6
          }
        }
      ]
    }
  }
}
```

The Coder deployment must support dev containers, allow public apps, and have [wildcard app DNS and TLS configured](https://coder.com/docs/admin/networking/wildcard-access-url) for `subdomain: true`. Rebuild the dev container from Coder after changing this configuration. The buttons belong to the dev container's agent.

| Dashboard button | Port | Access | Purpose |
| --- | --- | --- | --- |
| **Orca Web** | 6770 | `public` | Browser UI and WebSocket endpoint used by Orca clients. |
| **Pair Orca Desktop** | 6772 | `owner` | Private pairing page with a QR code, native pairing URL and browser access link. |

Keep the `orca` and `orca-pair` slugs: the pairing page uses them to infer the public app address. The feature installs the services; the project declares the buttons through [`customizations.coder.apps`](https://coder.com/docs/user-guides/devcontainers/customizing-dev-containers#custom-apps).

### Open the browser UI or pair Orca Desktop

1. Open **Pair Orca Desktop** while signed in as the workspace owner in Coder.
2. Check the **URL pública do Orca** field. It is inferred from the Coder app URL and the workspace directory name; if you set a custom Coder agent name or the inferred URL differs, enter the HTTPS address of **Orca Web** and click **Gerar link de acesso**.
3. For browser access, click **Abrir Orca Web com este acesso**. For Orca Desktop, scan the QR code or copy the native `orca://pair?code=...` URL into **Settings → Remote Orca Servers → Add Server**.
4. After authorizing a browser, you can use the **Orca Web** dashboard button directly.

The public app is reachable without a Coder login so Orca Desktop can connect to its WebSocket endpoint. Orca authenticates client sessions; the public gateway does not expose the pairing offer. Keep the pairing app set to `share: "owner"` and keep pairing links private, since they grant access to the Orca server. The browser access link carries the offer in its URL fragment.

All three listeners bind to loopback: public gateway **6770**, internal Orca backend **6771**, and private pairing **6772**. Only 6770 and 6772 need Coder apps. The public gateway blocks `/__orca`; do not expose the backend or private pairing port as public apps. No additional host Docker port publishing is required for this setup.

## Runtime and persistence

The feature version (`:1`, `:1.2`, or `:1.2.1`) is independent of the `version` option, which selects the Orca release.

`orca-web start` runs after container startup and registers the workspace directory. Commands: `start`, `stop`, `status`, `pair <public HTTPS URL>`, and `cli <arguments>`. Override the project with `ORCA_WEB_PROJECT_ROOT`.

The Docker volume is named `${devcontainerId}-orca-web` and mounted at `/var/lib/orca-web`. Dev Containers resolves `${devcontainerId}` to an identifier that is unique to each dev container and stable across rebuilds, keeping independent projects from sharing profiles or credentials. Orca is installed at `/opt/orca-web`, with the installed release recorded in `/opt/orca-web/orca-web-version`. The launcher and gateway resources are installed at `/usr/local/lib/orca-web` and exposed through `/usr/local/bin/orca-web`.

Logs are at `/var/lib/orca-web/server.log` and the profile is at `/var/lib/orca-web/profile`. The log contains pairing credentials; keep it private. The feature does not install Codex or other agent CLIs.

### Upgrading an existing installation

Version 1.2.1 gives each dev container its own default volume, `${devcontainerId}-orca-web`. Existing volumes are not renamed or deleted automatically. If you previously used the fixed `orca-web` volume, explicitly mount that existing volume as shown below before rebuilding to preserve its profile.

Installation paths remain `/opt/orca-web` and `/usr/local/lib/orca-web`.

If an earlier installation uses a different volume name, retain that volume by explicitly mounting it at `/var/lib/orca-web` in your project's `devcontainer.json`. Replace `YOUR_EXISTING_VOLUME` with the exact existing volume name:

```json
{
  "mounts": [
    {
      "source": "YOUR_EXISTING_VOLUME",
      "target": "/var/lib/orca-web",
      "type": "volume"
    }
  ]
}
```

The project mount overrides the feature mount at the same target. This reuses the existing profile without copying or deleting data. Do not run two containers against the same profile simultaneously. Independent projects are isolated by default. If you set an explicit volume source, choose a different name for each project to retain that isolation.

### Ownership and containers without sudo

The installer records `_REMOTE_USER` (falling back to `_CONTAINER_USER` and then `root`) and seeds the state directory with that user's numeric UID and primary GID. New Docker volumes inherit these permissions, so normal operation does not require sudo.

The feature entrypoint repairs ownership of reused volumes when running as root. It resolves the configured user's current UID/GID at startup, including changes made by `updateRemoteUserUID`, and does not follow profile symlinks. The lifecycle command checks ownership too and can use existing passwordless sudo if available.

If both the container entrypoint and remote user are non-root, sudo is absent, and an existing volume belongs to a different UID/GID, Linux requires a one-time initialization as root. Run `/usr/local/lib/orca-web/orca-web-init.sh` inside the container as root before starting Orca Web. The feature reports this explicitly and preserves the profile; it does not grant additional sudo permissions or make credentials world-readable.

## Coder session environment

No Terraform changes are required. Coder SSH and VS Code sessions receive the
agent's full environment, including Git authentication and template/user variables.
The devcontainer `postStartCommand` does not receive that environment.

The feature installs a login-shell hook in `/etc/profile.d/orca-web-coder.sh`.
On the first Coder SSH, web terminal, or VS Code login-shell session, it restarts
the lifecycle server once with the complete environment inherited from that
session. Later sessions leave the running server and its terminals alone.
Normal Orca profile isolation still replaces `ORCA_*` routing variables.
No environment snapshot or credentials are written to the persistent volume.

**Before that first Coder session, Orca only has the devcontainer environment.**
The one-time restart disconnects any Orca sessions opened before environment
adoption. Connect through Coder before opening Orca after a container restart.
If your configured shell does not source `/etc/profile.d`, run this once from
its Coder terminal instead:

```bash
orca-web inherit-environment
```

Rebuild the devcontainer to install the hook. Existing Orca terminals must be
reopened after the server adopts the Coder environment. Template changes or
updated secrets require `orca-web stop` followed by `orca-web inherit-environment`
from a new Coder session. This also works outside Coder: the normal lifecycle
startup is unchanged and the login hook does nothing.

## Development

```bash
node --test src/orca-web/orca-web-gateway.test.mjs
bash -n src/orca-web/*.sh test/*.sh

# Installation and runtime test (no sudo), also run in CI for all four users:
docker build --build-arg REMOTE_USER=node -f test/Dockerfile -t orca-web-user-test .
docker volume create orca-web-user-test
docker run --rm --mount type=volume,source=orca-web-user-test,target=/var/lib/orca-web --entrypoint bash orca-web-user-test /usr/local/lib/orca-web/test-user.sh
docker volume rm orca-web-user-test
```

## Publishing

Increase `version` in `src/orca-web/devcontainer-feature.json` using SemVer and merge to `main`. The Publish feature workflow waits for the gateway tests and the installation/runtime matrix (`vscode`, `node`, `developer`, `root`), then uses the official `devcontainers/action` to publish OCI artifacts to GHCR with full, minor and major version tags. Published versions must not be reused for changed content. The workflow can also be run manually. Authentication uses `GITHUB_TOKEN` with `packages: write`; no personal token is required.

After the first publish, set the feature and collection packages to **public** in GitHub Packages settings if necessary. A public repository alone does not guarantee public packages. Verify anonymous pulls before using the feature elsewhere.

The vendored QR generator is qrcode-generator 1.4.4, copyright Kazuhiko Arase, licensed under MIT; its attribution is preserved in `src/orca-web/vendor/qrcode.js`. Orca is downloaded from the upstream stablyai/orca releases and remains subject to its upstream license.
