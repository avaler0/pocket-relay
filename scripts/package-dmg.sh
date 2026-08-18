#!/bin/sh

set -eu

pocket_relay_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
pocket_relay_app="$pocket_relay_root/dist/Pocket Relay.app"
pocket_relay_dmg="$pocket_relay_root/dist/Pocket Relay.dmg"
pocket_relay_staging=$(mktemp -d "${TMPDIR:-/tmp}/pocket-relay-dmg.XXXXXX")

cleanup() {
  /bin/rm -rf "$pocket_relay_staging"
}

trap cleanup EXIT HUP INT TERM

"$pocket_relay_root/scripts/package-macos.sh"

/usr/bin/plutil -lint "$pocket_relay_app/Contents/Info.plist"
/usr/bin/lipo "$pocket_relay_app/Contents/MacOS/Pocket Relay" -verify_arch arm64 x86_64
/usr/bin/codesign --verify --deep --strict --verbose=2 "$pocket_relay_app"

/usr/bin/ditto --norsrc --noextattr \
  "$pocket_relay_app" \
  "$pocket_relay_staging/Pocket Relay.app"
/usr/bin/ditto --norsrc --noextattr \
  "$pocket_relay_root/packaging/macos/Start Pocket Relay.command" \
  "$pocket_relay_staging/Start Pocket Relay.command"
/usr/bin/ditto --norsrc --noextattr \
  "$pocket_relay_root/packaging/macos/DMG README.txt" \
  "$pocket_relay_staging/README.txt"
/bin/chmod 755 "$pocket_relay_staging/Start Pocket Relay.command"
/bin/ln -s /Applications "$pocket_relay_staging/Applications"

/usr/bin/hdiutil create \
  -volname 'Pocket Relay' \
  -srcfolder "$pocket_relay_staging" \
  -format UDZO \
  -ov \
  "$pocket_relay_dmg"

/usr/bin/hdiutil verify "$pocket_relay_dmg"
