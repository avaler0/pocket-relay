'use strict'

class PocketRelayApplication {
  constructor({ internet, ble, chat, persistence, presenter }) {
    this.internet = internet
    this.ble = ble
    this.chat = chat
    this.persistence = persistence
    this.presenter = presenter
    this.started = false
    this.closing = null
  }

  async start() {
    if (this.started) return
    this.started = true
    this.internet.on('connection', (stream, info) => {
      this.chat.addConnection({
        stream,
        transport: 'internet',
        remotePublicKey: info.remotePublicKey
      })
    })
    this.ble.on('connection', (stream, info) => {
      this.chat.addConnection({
        stream,
        transport: 'ble',
        remotePublicKey: info.remotePublicKey
      })
    })
    this.internet.on('error', (error) => this.presenter.error(`Internet: ${error.message}`))
    this.ble.on('error', (error) => this.presenter.error(`BLE: ${error.message}`))
    this.internet.on('update', () => this.ble.setOnline(this.internet.peers > 0))

    await Promise.all([
      this.internet.start().catch((error) => this.presenter.error(`Internet unavailable: ${error.message}`)),
      this.ble.start().catch((error) => this.presenter.error(`BLE unavailable: ${error.message}`))
    ])
    this.ble.setOnline(this.internet.peers > 0)
  }

  status() {
    const counts = this.chat.peerCounts()
    return {
      bleState: this.ble.state,
      blePeers: counts.ble,
      internetState: this.internet.state,
      internetPeers: counts.internet
    }
  }

  shutdown() {
    if (this.closing) return this.closing
    this.closing = this._shutdown()
    return this.closing
  }

  async _shutdown() {
    await Promise.all([
      this.ble.stop().catch((error) => this.presenter.error(`BLE shutdown: ${error.message}`)),
      this.internet.stop().catch((error) => this.presenter.error(`Internet shutdown: ${error.message}`))
    ])
    await this.chat.close()
    await this.persistence.close()
  }
}

module.exports = PocketRelayApplication
