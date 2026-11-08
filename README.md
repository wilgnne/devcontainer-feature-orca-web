# Orca Web Dev Container Feature

Installs Orca Web, a persistent profile, lifecycle commands and separate public and private pairing gateways.

## Usage

Requires **Ubuntu 26.04**, the **vscode** user, and x86_64 or arm64.

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

The feature version (`:1`, `:1.0`, or `:1.0.0`) is independent of the `version` option, which selects the Orca release.

`orca-web start` runs after container startup and registers the workspace directory. Commands: `start`, `stop`, `status`, `pair <public HTTPS URL>`, and `cli <arguments>`. Override the project with `ORCA_WEB_PROJECT_ROOT`.

For compatibility with existing installations, the Docker volume remains `homeprod-orca-web`, mounted at `/home/vscode/.local/share/homeprod-orca-web`. Installation paths also retain the existing `homeprod` names. The feature does not install Codex or other agent CLIs.

The public HTTP/WebSocket gateway listens on loopback port 6770, the Orca backend on 6771, and private pairing on 6772. Configure your Coder apps separately: expose 6770 as the Orca app and 6772 as an owner-only pairing app. The public gateway blocks `/__orca`; never expose the private pairing listener publicly. Pairing links grant server access and must remain private.

## Development

```bash
node --test src/orca-web/orca-web-gateway.test.mjs
bash -n src/orca-web/*.sh
```

## Publishing

Increase `version` in `src/orca-web/devcontainer-feature.json` using SemVer and merge to `main`. The Publish feature workflow runs tests, then uses the official `devcontainers/action` to publish OCI artifacts to GHCR with full, minor and major version tags. Published versions must not be reused for changed content. The workflow can also be run manually. Authentication uses `GITHUB_TOKEN` with `packages: write`; no personal token is required.

After the first publish, set the feature and collection packages to **public** in GitHub Packages settings if necessary. A public repository alone does not guarantee public packages. Verify anonymous pulls before using the feature elsewhere.

The vendored QR generator is qrcode-generator 1.4.4, copyright Kazuhiko Arase, licensed under MIT; its attribution is preserved in `src/orca-web/vendor/qrcode.js`. Orca is downloaded from the upstream stablyai/orca releases and remains subject to its upstream license.
