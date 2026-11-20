#!/usr/bin/env bash
set -euo pipefail

version="${1:?Orca release tag is required}"
destination="${2:?Installation directory is required}"
case "$(uname -m)" in
  x86_64) asset=orca-linux.AppImage ;;
  aarch64|arm64) asset=orca-linux-arm64.AppImage ;;
  *) echo 'Unsupported Orca architecture' >&2; exit 1 ;;
esac

staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
url="https://github.com/stablyai/orca/releases/download/$version/$asset"
printf '[orca-web] Downloading Orca AppImage from %q\n' "$url"
curl -fsSL --retry 3 "$url" -o "$staging/orca.AppImage"
chmod +x "$staging/orca.AppImage"
(cd "$staging" && ./orca.AppImage --appimage-extract >/dev/null)
mkdir -p "$destination"
cp -a "$staging/squashfs-root/." "$destination/"
chmod -R a+rX "$destination"
printf '%s\n' "$version" > "$destination/orca-web-version"
printf '[orca-web] Recorded Orca release %q in %q\n' "$version" "$destination/orca-web-version"
