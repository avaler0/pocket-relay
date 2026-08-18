#!/bin/sh

set -eu

pocket_relay_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
pocket_relay_build_dir=$(mktemp -d "${TMPDIR:-/tmp}/pocket-relay-build.XXXXXX")
pocket_relay_built_app="$pocket_relay_build_dir/Pocket Relay.app"
pocket_relay_output_dir="$pocket_relay_root/dist"
pocket_relay_output_app="$pocket_relay_output_dir/Pocket Relay.app"

cleanup() {
  /bin/rm -rf "$pocket_relay_build_dir"
}

trap cleanup EXIT HUP INT TERM

cd "$pocket_relay_root"

PATH="$pocket_relay_root/scripts/macos-tools:$PATH"
export PATH

"$pocket_relay_root/node_modules/.bin/bare-build" \
  --host darwin-arm64 \
  --host darwin-x64 \
  --name "Pocket Relay" \
  --identifier com.pocketrelay.app \
  --minimum-version 13.0 \
  --info-plist packaging/macos/Info.plist \
  --out "$pocket_relay_build_dir" \
  app.js

/usr/bin/xattr -cr "$pocket_relay_built_app"
/bin/mkdir -p "$pocket_relay_output_dir"

if [ -e "$pocket_relay_output_app" ]; then
  /bin/rm -rf "$pocket_relay_output_app"
fi

/bin/mv "$pocket_relay_built_app" "$pocket_relay_output_app"
