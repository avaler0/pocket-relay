'use strict'

const RESET = '\u001b[0m'
const COLORS = {
  ble: '\u001b[36m',
  internet: '\u001b[32m',
  duplicate: '\u001b[35m',
  error: '\u001b[31m',
  local: '\u001b[2;37m'
}

function paint(text, color, enabled) {
  return enabled ? COLORS[color] + text + RESET : text
}

function shortKey(key) {
  return typeof key === 'string' ? key.slice(0, 6) : '??????'
}

function transportLine({ direction, transport, peerKey, message, duplicate = false }) {
  const arrow = direction === 'send' ? '→' : '←'
  const body = `[${transport.toUpperCase()} ${arrow} ${shortKey(peerKey)}] ${message.author}: ${message.text}`
  return duplicate ? `[DUPLICATE] ${body}` : body
}

module.exports = { COLORS, paint, shortKey, transportLine }
