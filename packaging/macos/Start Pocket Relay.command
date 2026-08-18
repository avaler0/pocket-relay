#!/bin/sh

set -eu

pocket_relay_launcher_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
pocket_relay_app='/Applications/Pocket Relay.app'

if [ ! -d "$pocket_relay_app" ]; then
  pocket_relay_app="$pocket_relay_launcher_dir/Pocket Relay.app"
fi

if [ ! -d "$pocket_relay_app" ]; then
  echo 'Pocket Relay.app was not found. Drag it to Applications or keep it beside this launcher.' >&2
  exit 1
fi

printf 'Display name [Anonymous]: '
IFS= read -r pocket_relay_name

if [ -z "$pocket_relay_name" ]; then
  pocket_relay_name='Anonymous'
fi

printf 'Room topic (leave blank to create a room): '
IFS= read -r pocket_relay_room

pocket_relay_tty=$(tty)

if [ -n "$pocket_relay_room" ]; then
  exec /usr/bin/open \
    -W \
    -n \
    --stdin "$pocket_relay_tty" \
    --stdout "$pocket_relay_tty" \
    --stderr "$pocket_relay_tty" \
    "$pocket_relay_app" \
    --args --name "$pocket_relay_name" --room "$pocket_relay_room"
fi

exec /usr/bin/open \
  -W \
  -n \
  --stdin "$pocket_relay_tty" \
  --stdout "$pocket_relay_tty" \
  --stderr "$pocket_relay_tty" \
  "$pocket_relay_app" \
  --args --name "$pocket_relay_name"
