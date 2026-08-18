#!/bin/sh

set -eu

pocket_relay_app='./dist/Pocket Relay.app'

if [ ! -d "$pocket_relay_app" ]; then
  echo 'Pocket Relay is not packaged. Run: npm run package:mac' >&2
  exit 1
fi

pocket_relay_tty=$(tty)

exec /usr/bin/open \
  -W \
  -n \
  --stdin "$pocket_relay_tty" \
  --stdout "$pocket_relay_tty" \
  --stderr "$pocket_relay_tty" \
  "$pocket_relay_app" \
  --args "$@"
