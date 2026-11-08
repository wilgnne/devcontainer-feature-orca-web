# Orca Web Dev Container Feature

Installs Orca Web, a persistent profile, lifecycle commands and separate public and private pairing gateways.

## Usage

Requires **Ubuntu 26.04** and x86_64 or arm64. The effective Dev Container `remoteUser` is detected automatically (`vscode`, `node`, a custom user, or `root`). The primary group is resolved independently of the username.

```json
{
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu26.04",
  "features": {
    "ghcr.io/wilgnne/devcontainer-feature-orca-web/orca-web:1": {
      "version": "v1.4.253"
    }
  }
}
```

The feature version (`:1`, `:1.2`, or `:1.2.0`) is independent of the `version` option, which selects the Orca release.

`orca-web start` runs after container startup and registers the workspace directory. Commands: `start`, `stop`, `status`, `pair <public HTTPS URL>`, and `cli <arguments>`. Override the project with `ORCA_WEB_PROJECT_ROOT`.

The Docker volume is named `orca-web` and mounted at `/var/lib/orca-web`. Orca is installed at `/opt/orca-web`, with the installed release recorded in `/opt/orca-web/orca-web-version`. The launcher and gateway resources are installed at `/usr/local/lib/orca-web` and exposed through `/usr/local/bin/orca-web`.

Logs are at `/var/lib/orca-web/server.log` and the profile is at `/var/lib/orca-web/profile`. The log contains pairing credentials; keep it private. The feature does not install Codex or other agent CLIs.

### Upgrading an existing installation

Version 1.2.0 standardizes installation paths and the default volume name on `orca-web`. Rebuild the container to install the binaries at the new location.

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

The project mount overrides the feature mount at the same target. This reuses the existing profile without copying or deleting data. Do not run two containers against the same profile simultaneously. For independent projects, use a distinct volume source for each project.

### Ownership and containers without sudo

The installer records `_REMOTE_USER` (falling back to `_CONTAINER_USER` and then `root`) and seeds the state directory with that user's numeric UID and primary GID. New Docker volumes inherit these permissions, so normal operation does not require sudo.

The feature entrypoint repairs ownership of reused volumes when running as root. It resolves the configured user's current UID/GID at startup, including changes made by `updateRemoteUserUID`, and does not follow profile symlinks. The lifecycle command checks ownership too and can use existing passwordless sudo if available.

If both the container entrypoint and remote user are non-root, sudo is absent, and an existing volume belongs to a different UID/GID, Linux requires a one-time initialization as root. Run `/usr/local/lib/orca-web/orca-web-init.sh` inside the container as root before starting Orca Web. The feature reports this explicitly and preserves the profile; it does not grant additional sudo permissions or make credentials world-readable.

The public HTTP/WebSocket gateway listens on loopback port 6770, the Orca backend on 6771, and private pairing on 6772. Configure your Coder apps separately: expose 6770 as the Orca app and 6772 as an owner-only pairing app. The public gateway blocks `/__orca`; never expose the private pairing listener publicly. Pairing links grant server access and must remain private.

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
