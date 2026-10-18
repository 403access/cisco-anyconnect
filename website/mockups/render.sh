#!/usr/bin/env bash
#
# Rasterises the mockups in this directory into the images used by the site.
#
# IMPORTANT: these are HTML/CSS re-creations of the bundled example app and of the project's own
# branding. They are NOT device screenshots. See ../README.md.
#
# Usage: ./render.sh
set -euo pipefail

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(cd "$HERE/.." && pwd)/assets"

SCALE=2

if [[ ! -x "$CHROME" ]]; then
  echo "Chrome not found at: $CHROME" >&2
  echo "Set CHROME=/path/to/chrome, or install Google Chrome." >&2
  exit 1
fi

mkdir -p "$OUT"

# name|logical width|logical height
TARGETS=(
  "android-connected|421|880"
  "ios-callback-error|421|880"
  "og-card|1200|630"
)

for target in "${TARGETS[@]}"; do
  IFS='|' read -r name width height <<<"$target"
  echo "rendering $name (${width}x${height} @${SCALE}x)"

  args=(
    --headless=new
    --disable-gpu
    --hide-scrollbars
    --allow-file-access-from-files
    --default-background-color=00000000
    --window-size="$width,$height"
    --screenshot="$OUT/$name.png"
  )

  # The social card embeds a device PNG, so it must render at 1x to keep the composition honest.
  if [[ "$name" == "og-card" ]]; then
    args+=(--force-device-scale-factor=1)
  else
    args+=(--force-device-scale-factor="$SCALE")
  fi

  "$CHROME" "${args[@]}" "file://$HERE/$name.html" >/dev/null 2>&1
done

if command -v magick >/dev/null 2>&1; then
  echo
  echo "optimising"
  for png in "$OUT"/*.png; do
    base="${png%.png}"
    magick "$png" -strip -define png:compression-level=9 "$png"
    magick "$png" -strip -quality 82 "$base.webp"
  done
fi

echo
ls -lh "$OUT" | tail -n +2
