'use strict'

const b4a = require('b4a')
const crypto = require('hypercore-crypto')
const { FrameDecoder, encodeFrame, validateChat } = require('./protocol')

class ChatState {
  constructor({ name, publicKey, persistence, presenter }) {
    this.name = name
    this.publicKey = typeof publicKey === 'string' ? publicKey : b4a.toString(publicKey, 'hex')
    this.persistence = persistence
    this.presenter = presenter
    this.messages = new Map()
    this.deliveries = []
    this.connections = new Map()
    this.nextConnectionId = 1
    this.pending = new Set()
    this.operations = Promise.resolve()
    this.closed = false
  }

  async load() {
    const [messages, deliveries] = await Promise.all([
      this.persistence.loadMessages(),
      this.persistence.loadDeliveries()
    ])
    for (const message of messages) {
      if (!validateChat(message) && !this.messages.has(message.id)) {
        this.messages.set(message.id, message)
      }
    }
    for (const event of deliveries) {
      if (event && (event.direction === 'send' || event.direction === 'arrival')) {
        this.deliveries.push(event)
      }
    }
    return this
  }

  addConnection({ stream, transport, remotePublicKey }) {
    if (this.closed) throw new Error('chat state is closed')
    if (transport !== 'ble' && transport !== 'internet') {
      throw new Error('unknown transport')
    }
    const peerKey = typeof remotePublicKey === 'string'
      ? remotePublicKey
      : b4a.toString(remotePublicKey || stream.remotePublicKey, 'hex')
    const connection = {
      id: this.nextConnectionId++,
      stream,
      transport,
      peerKey,
      sentIds: new Set(),
      closed: false,
      decoder: null
    }
    connection.decoder = new FrameDecoder({
      onFrame: (message) => this._enqueue(() => this._receive(connection, message)),
      onError: (error) => this.presenter.error(
        `${transport.toUpperCase()} ${peerKey.slice(0, 6)}: ${error.message}`
      )
    })
    this.connections.set(connection.id, connection)

    stream.on('data', (chunk) => connection.decoder.push(chunk))
    stream.on('error', (error) => {
      this.presenter.error(`${transport.toUpperCase()} ${peerKey.slice(0, 6)}: ${error.message}`)
      this.removeConnection(connection)
    })
    stream.on('end', () => this.removeConnection(connection))
    stream.on('close', () => this.removeConnection(connection))

    for (const message of this.messages.values()) this._send(connection, message)
    return connection
  }

  removeConnection(connection) {
    if (!connection || connection.closed) return
    connection.closed = true
    connection.decoder.end()
    this.connections.delete(connection.id)
  }

  sendLocal(text) {
    return this._enqueue(() => {
      const message = {
        type: 'chat',
        id: b4a.toString(crypto.randomBytes(16), 'hex'),
        author: this.name,
        authorKey: this.publicKey,
        text,
        createdAt: Date.now()
      }
      const error = validateChat(message)
      if (error) throw new Error(error)
      this.messages.set(message.id, message)
      this._track(this.persistence.appendMessage(message))

      let sent = 0
      for (const connection of this.connections.values()) {
        if (this._send(connection, message)) sent++
      }
      if (sent === 0) this.presenter.queued(message)
      return message
    })
  }

  _receive(source, message) {
    const duplicate = this.messages.has(message.id)
    if (!duplicate) {
      this.messages.set(message.id, message)
      this._track(this.persistence.appendMessage(message))
    }

    this._record({
      direction: 'arrival',
      transport: source.transport,
      peerKey: source.peerKey,
      message,
      duplicate
    })

    if (duplicate) return
    for (const connection of this.connections.values()) {
      if (connection !== source) this._send(connection, message)
    }
  }

  _send(connection, message) {
    if (connection.closed || connection.sentIds.has(message.id)) return false
    connection.sentIds.add(message.id)
    let accepted = false
    try {
      connection.stream.write(encodeFrame(message))
      accepted = true
    } catch (error) {
      connection.sentIds.delete(message.id)
      this.presenter.error(
        `${connection.transport.toUpperCase()} ${connection.peerKey.slice(0, 6)}: ${error.message}`
      )
      this.removeConnection(connection)
      if (typeof connection.stream.destroy === 'function') connection.stream.destroy(error)
    }
    if (accepted) {
      this._record({
        direction: 'send',
        transport: connection.transport,
        peerKey: connection.peerKey,
        message,
        duplicate: false
      })
    }
    return accepted
  }

  _record({ direction, transport, peerKey, message, duplicate }) {
    const event = {
      direction,
      transport,
      peerKey,
      messageId: message.id,
      duplicate,
      recordedAt: Date.now(),
      message
    }
    this.deliveries.push(event)
    this._track(this.persistence.appendDelivery(event))
    this.presenter.delivery(event)
  }

  _enqueue(operation) {
    const result = this.operations.then(operation)
    this.operations = result.catch((error) => this.presenter.error(error.message))
    return result
  }

  _track(promise) {
    const handled = Promise.resolve(promise)
      .catch((error) => this.presenter.error(`Storage: ${error.message}`))
      .finally(() => this.pending.delete(handled))
    this.pending.add(handled)
  }

  history() {
    return [...this.messages.values()]
  }

  deliveryHistory() {
    return this.deliveries.slice()
  }

  peerList() {
    return [...this.connections.values()].map(({ peerKey, transport }) => ({ peerKey, transport }))
  }

  peerCounts() {
    const counts = { ble: 0, internet: 0 }
    for (const connection of this.connections.values()) counts[connection.transport]++
    return counts
  }

  async drain() {
    await this.operations
    while (this.pending.size) await Promise.all([...this.pending])
    await this.persistence.flush()
  }

  async close() {
    if (this.closed) return
    this.closed = true
    for (const connection of [...this.connections.values()]) {
      this.removeConnection(connection)
      if (typeof connection.stream.destroy === 'function') connection.stream.destroy()
    }
    await this.drain()
  }
}

module.exports = ChatState
