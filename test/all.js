'use strict'

const test = require('brittle')
const b4a = require('b4a')
const EventEmitter = require('bare-events')
const fs = require('bare-fs')
const { Duplex } = require('bare-stream')
const crypto = require('hypercore-crypto')

const ChatState = require('../src/chat-state')
const PocketRelayApplication = require('../src/application')
const BleTransport = require('../src/transports/ble')
const { FrameDecoder, MAX_FRAME_BYTES, encodeFrame } = require('../src/protocol')
const { transportLine } = require('../src/format')
const { JsonlPersistence } = require('../src/persistence')

class MemoryPersistence {
  constructor() {
    this.messages = []
    this.deliveries = []
    this.closed = false
  }

  async loadMessages() { return this.messages.slice() }
  async loadDeliveries() { return this.deliveries.slice() }
  async appendMessage(message) { this.messages.push(message) }
  async appendDelivery(event) { this.deliveries.push(event) }
  async flush() {}
  async close() { this.closed = true }
}

class CapturePresenter {
  constructor() {
    this.lines = []
    this.errors = []
  }

  delivery(event) { this.lines.push(transportLine(event)) }
  queued(message) { this.lines.push(`[LOCAL/QUEUED] ${message.author}: ${message.text}`) }
  error(message) { this.errors.push(message) }
}

class FakeDuplex extends Duplex {
  constructor(key = crypto.randomBytes(32)) {
    const writes = []
    super({
      read() {},
      write(data, encoding, callback) {
        writes.push(b4a.from(data))
        callback(null)
      }
    })
    this.writes = writes
    this.remotePublicKey = key
  }

  receive(data) {
    this.emit('data', b4a.from(data))
  }
}

function message(id, text = 'hello') {
  return {
    type: 'chat',
    id,
    author: 'Bob',
    authorKey: 'ab'.repeat(32),
    text,
    createdAt: 1234567890
  }
}

async function setup() {
  const persistence = new MemoryPersistence()
  const presenter = new CapturePresenter()
  const chat = await new ChatState({
    name: 'Alice',
    publicKey: 'cd'.repeat(32),
    persistence,
    presenter
  }).load()
  return { chat, persistence, presenter }
}

test('suite executes in the Bare runtime', (t) => {
  t.is(typeof Bare, 'object')
  t.ok(Bare.version)
  t.absent(globalThis.process, 'Node process global is absent')
})

test('first arrival is canonical and later cross-transport arrival is visible duplicate', async (t) => {
  const { chat, persistence, presenter } = await setup()
  const ble = new FakeDuplex(b4a.from('11'.repeat(32), 'hex'))
  const internet = new FakeDuplex(b4a.from('22'.repeat(32), 'hex'))
  chat.addConnection({ stream: ble, transport: 'ble', remotePublicKey: ble.remotePublicKey })
  chat.addConnection({ stream: internet, transport: 'internet', remotePublicKey: internet.remotePublicKey })

  const incoming = message('same-id', 'Meet at 18:00')
  ble.receive(encodeFrame(incoming))
  internet.receive(encodeFrame(incoming))
  await chat.drain()

  t.is(chat.history().length, 1, 'canonical history has one copy')
  const arrivals = chat.deliveryHistory().filter((event) => event.direction === 'arrival')
  t.is(arrivals.length, 2, 'both arrivals are logged')
  t.alike(arrivals.map((event) => event.transport), ['ble', 'internet'])
  t.is(persistence.messages.length, 1, 'one canonical record persisted')
  t.ok(presenter.lines.some((line) => line === '[BLE ← 111111] Bob: Meet at 18:00'))
  t.ok(presenter.lines.some((line) => line === '[DUPLICATE] [INTERNET ← 222222] Bob: Meet at 18:00'))
})

test('one local message sends and prints separately on BLE and internet', async (t) => {
  const { chat, presenter } = await setup()
  const ble = new FakeDuplex(b4a.from('33'.repeat(32), 'hex'))
  const internet = new FakeDuplex(b4a.from('44'.repeat(32), 'hex'))
  chat.addConnection({ stream: ble, transport: 'ble', remotePublicKey: ble.remotePublicKey })
  chat.addConnection({ stream: internet, transport: 'internet', remotePublicKey: internet.remotePublicKey })

  await chat.sendLocal('two paths')
  await chat.drain()

  t.is(ble.writes.length, 1)
  t.is(internet.writes.length, 1)
  t.ok(presenter.lines.some((line) => line === '[BLE → 333333] Alice: two paths'))
  t.ok(presenter.lines.some((line) => line === '[INTERNET → 444444] Alice: two paths'))
})

test('duplicate arrival is recorded but never forwarded again', async (t) => {
  const { chat } = await setup()
  const first = new FakeDuplex(b4a.from('51'.repeat(32), 'hex'))
  const duplicateSource = new FakeDuplex(b4a.from('52'.repeat(32), 'hex'))
  const target = new FakeDuplex(b4a.from('53'.repeat(32), 'hex'))
  chat.addConnection({ stream: first, transport: 'ble', remotePublicKey: first.remotePublicKey })
  chat.addConnection({ stream: duplicateSource, transport: 'internet', remotePublicKey: duplicateSource.remotePublicKey })
  chat.addConnection({ stream: target, transport: 'internet', remotePublicKey: target.remotePublicKey })

  const incoming = message('no-loop')
  first.receive(encodeFrame(incoming))
  await chat.drain()
  t.is(target.writes.length, 1, 'unique arrival forwarded')
  duplicateSource.receive(encodeFrame(incoming))
  await chat.drain()
  t.is(target.writes.length, 1, 'duplicate was not forwarded')
})

test('unique arrival forwards to other connections but not its source', async (t) => {
  const { chat } = await setup()
  const source = new FakeDuplex(b4a.from('61'.repeat(32), 'hex'))
  const target = new FakeDuplex(b4a.from('62'.repeat(32), 'hex'))
  chat.addConnection({ stream: source, transport: 'ble', remotePublicKey: source.remotePublicKey })
  chat.addConnection({ stream: target, transport: 'internet', remotePublicKey: target.remotePublicKey })
  source.receive(encodeFrame(message('forward-me')))
  await chat.drain()
  t.is(source.writes.length, 0)
  t.is(target.writes.length, 1)
})

test('queued canonical history is sent once to a later peer', async (t) => {
  const { chat, presenter } = await setup()
  await chat.sendLocal('carry me')
  t.ok(presenter.lines.includes('[LOCAL/QUEUED] Alice: carry me'))
  const later = new FakeDuplex(b4a.from('71'.repeat(32), 'hex'))
  chat.addConnection({ stream: later, transport: 'internet', remotePublicKey: later.remotePublicKey })
  await chat.drain()
  t.is(later.writes.length, 1)
  t.ok(later.writes[0].toString().includes('carry me'))
})

test('NDJSON decoder handles split and combined frames', (t) => {
  const frames = []
  const errors = []
  const decoder = new FrameDecoder({ onFrame: (frame) => frames.push(frame), onError: (error) => errors.push(error) })
  const one = encodeFrame(message('one', 'uno'))
  const two = encodeFrame(message('two', 'dos'))
  decoder.push(one.subarray(0, 7))
  decoder.push(b4a.concat([one.subarray(7), two]))
  t.alike(frames.map((frame) => frame.id), ['one', 'two'])
  t.is(errors.length, 0)
})

test('malformed and oversized frames are rejected and parsing continues', (t) => {
  const frames = []
  const errors = []
  const decoder = new FrameDecoder({ onFrame: (frame) => frames.push(frame), onError: (error) => errors.push(error) })
  decoder.push('{not json}\n')
  const oversized = b4a.alloc(MAX_FRAME_BYTES + 1)
  oversized.fill(120)
  decoder.push(b4a.concat([oversized, b4a.from('\n'), encodeFrame(message('valid-after-errors'))]))
  t.is(errors.length, 2)
  t.alike(frames.map((frame) => frame.id), ['valid-after-errors'])
})

test('Bare filesystem persistence retains identity, canonical messages, and deliveries', async (t) => {
  const baseDir = await fs.mkdtemp('/tmp/pocket-relay-test-')
  t.teardown(() => fs.rm(baseDir, { recursive: true, force: true }))
  const topicHex = 'ef'.repeat(32)
  const first = await new JsonlPersistence({ baseDir, topicHex }).open()
  const seed = await first.loadOrCreateSeed()
  const stored = message('persisted')
  await first.appendMessage(stored)
  await first.appendDelivery({ direction: 'arrival', transport: 'ble', message: stored })
  await first.close()

  const reopened = await new JsonlPersistence({ baseDir, topicHex }).open()
  t.alike(await reopened.loadOrCreateSeed(), seed)
  t.alike(await reopened.loadMessages(), [stored])
  t.is((await reopened.loadDeliveries())[0].transport, 'ble')
  await reopened.close()
})

class FakeAdapter extends EventEmitter {
  constructor(state, { fail = false } = {}) {
    super()
    this.state = state
    this.peers = 0
    this.fail = fail
    this.started = false
    this.stopped = false
    this.onlineHints = []
  }
  async start() {
    this.started = true
    if (this.fail) throw new Error('not available')
    if (this.state !== 'unsupported') this.state = 'on'
  }
  setOnline(value) { this.onlineHints.push(value) }
  async stop() { this.stopped = true; this.state = 'off' }
}

test('unsupported BLE does not block internet and shutdown closes transports and storage', async (t) => {
  const { chat, persistence, presenter } = await setup()
  const internet = new FakeAdapter('off')
  const ble = new FakeAdapter('unsupported')
  const application = new PocketRelayApplication({ internet, ble, chat, persistence, presenter })
  await application.start()
  t.ok(internet.started, 'internet started')
  t.ok(ble.started, 'BLE was safely probed')
  t.is(application.status().internetState, 'on')
  t.is(application.status().bleState, 'unsupported')

  await application.shutdown()
  t.ok(internet.stopped)
  t.ok(ble.stopped)
  t.ok(persistence.closed)
  t.ok(chat.closed)
})

test('disabled BLE adapter never initializes a hazardous native backend', async (t) => {
  class MustNotConstruct {
    constructor() { throw new Error('native backend was constructed') }
  }
  const ble = new BleTransport({
    keyPair: crypto.keyPair(),
    topic: crypto.randomBytes(32),
    Bluetooth: MustNotConstruct,
    enabled: false,
    disabledState: 'unavailable'
  })
  await ble.start()
  t.is(ble.state, 'unavailable')
  t.is(ble.peers, 0)
  await ble.stop()
  t.pass('safe no-op lifecycle')
})
