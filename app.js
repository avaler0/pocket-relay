'use strict'

const b4a = require('b4a')
const crypto = require('hypercore-crypto')
const readline = require('bare-readline')
const tty = require('bare-tty')
const Signal = require('bare-signals')

const ChatState = require('./src/chat-state')
const PocketRelayApplication = require('./src/application')
const { JsonlPersistence } = require('./src/persistence')
const TerminalPresenter = require('./src/terminal')
const HyperswarmTransport = require('./src/transports/hyperswarm')
const BleTransport = require('./src/transports/ble')
const { transportLine, shortKey } = require('./src/format')

function option(name) {
  const index = Bare.argv.indexOf(name)
  return index === -1 ? null : Bare.argv[index + 1]
}

function isStockMacBareCli() {
  const executable = Bare.argv[0] || ''
  return Bare.platform === 'darwin' && /\/bare$/.test(executable)
}

function parseRoom(value) {
  if (value === null) return null
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('--room must be exactly 64 hexadecimal characters')
  }
  return b4a.from(value, 'hex')
}

async function main() {
  const output = new tty.WriteStream(1)
  const presenter = new TerminalPresenter({ output, colors: true })
  const name = option('--name') || 'Anonymous'
  if (!name.trim() || b4a.byteLength(name) > 128 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('--name must contain between 1 and 128 UTF-8 bytes')
  }

  let topic = parseRoom(option('--room'))
  const generated = topic === null
  if (generated) topic = crypto.randomBytes(32)
  const topicHex = b4a.toString(topic, 'hex')

  const persistence = await new JsonlPersistence({ topicHex }).open()
  const seed = await persistence.loadOrCreateSeed()
  const keyPair = crypto.keyPair(seed)
  const publicKeyHex = b4a.toString(keyPair.publicKey, 'hex')

  const chat = await new ChatState({
    name,
    publicKey: publicKeyHex,
    persistence,
    presenter
  }).load()
  const internet = new HyperswarmTransport({ keyPair, topic })
  const stockMacBareCli = isStockMacBareCli()
  const ble = new BleTransport({
    keyPair,
    topic,
    enabled: !stockMacBareCli,
    disabledState: 'unavailable (macOS host needs Bluetooth usage metadata)'
  })
  const application = new PocketRelayApplication({
    internet,
    ble,
    chat,
    persistence,
    presenter
  })

  presenter.line('Pocket Relay')
  presenter.line(`Identity: ${shortKey(publicKeyHex)}  Name: ${name}`)
  presenter.line(`Room: ${topicHex}`)
  if (generated) {
    presenter.line('Generated a new room topic. Share it to invite peers.')
  }
  presenter.line('The room topic is an invite/discovery token, not a password; anyone with it can join.')
  presenter.line('Type /help for commands.')
  if (stockMacBareCli) {
    presenter.line(
      'BLE disabled: the stock macOS Bare CLI has no NSBluetoothAlwaysUsageDescription and macOS would abort it.',
      'local'
    )
  }

  const input = new tty.ReadStream(0)
  input.setRawMode(true)
  const rl = readline.createInterface({ input, output, prompt: '> ' })
  presenter.attachReadline(rl)

  const signals = []
  let quitting = false
  async function quit(code = 0) {
    if (quitting) return
    quitting = true
    rl.close()
    input.setRawMode(false)
    for (const signal of signals) await signal.close()
    await application.shutdown()
    output.write('\r\n')
    Bare.exit(code)
  }

  for (const name of ['SIGINT', 'SIGTERM']) {
    try {
      const signal = new Signal(name)
      signal.on('signal', () => quit(0)).start()
      signals.push(signal)
    } catch (_) {}
  }

  async function command(line) {
    switch (line.trim()) {
      case '/help':
        presenter.line('/help /status /peers /history /deliveries /invite /quit')
        break
      case '/status': {
        const status = application.status()
        presenter.line(`BLE: ${status.bleState} (${status.blePeers} peers)`)
        presenter.line(`Internet: ${status.internetState} (${status.internetPeers} peers)`)
        break
      }
      case '/peers': {
        const peers = chat.peerList()
        if (peers.length === 0) presenter.line('No connected peers.', 'local')
        for (const peer of peers) {
          presenter.line(`${peer.transport.toUpperCase()} ${peer.peerKey}`)
        }
        break
      }
      case '/history': {
        const history = chat.history()
        if (history.length === 0) presenter.line('No canonical messages.', 'local')
        for (const message of history) {
          presenter.line(`[HISTORY] ${message.author}: ${message.text}`, 'local')
        }
        break
      }
      case '/deliveries': {
        const deliveries = chat.deliveryHistory()
        if (deliveries.length === 0) presenter.line('No delivery events.', 'local')
        for (const event of deliveries) {
          const color = event.duplicate ? 'duplicate' : event.transport
          presenter.line(transportLine(event), color)
        }
        break
      }
      case '/invite':
        presenter.line(`Room: ${topicHex}`)
        presenter.line('This topic is an invite/discovery token, not a password.')
        break
      case '/quit':
        return quit(0)
      case '':
        break
      default:
        if (line.trim().startsWith('/')) presenter.error('Unknown command. Type /help.')
        else await chat.sendLocal(line)
    }
  }

  let commandQueue = Promise.resolve()
  rl.on('data', (line) => {
    commandQueue = commandQueue
      .then(() => command(line))
      .catch((error) => presenter.error(error.message))
  })
  rl.on('end', () => quit(0))
  rl.prompt()
  await application.start()
}

main().catch((error) => {
  const detail = error && error.stack ? error.stack : String(error)
  try {
    const output = new tty.WriteStream(2)
    output.write(`[ERROR] ${detail}\r\n`, () => Bare.exit(1))
  } catch (_) {
    console.error(`[ERROR] ${detail}`)
    Bare.exit(1)
  }
})
