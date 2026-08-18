'use strict'

const EventEmitter = require('bare-events')
const BluetoothSwarm = require('ble-swarm')

class BleTransport extends EventEmitter {
  constructor({
    keyPair,
    topic,
    Bluetooth = BluetoothSwarm,
    enabled = true,
    disabledState = 'unsupported'
  }) {
    super()
    this.disabledState = disabledState
    if (!enabled) {
      this.bluetooth = null
      return
    }
    this.bluetooth = new Bluetooth({ keyPair, topic })
    this.bluetooth.on('connection', (stream) => {
      this.emit('connection', stream, { remotePublicKey: stream.remotePublicKey })
      this.emit('update')
    })
    this.bluetooth.on('update', () => this.emit('update'))
  }

  get state() {
    return this.bluetooth ? this.bluetooth.state : this.disabledState
  }

  get peers() {
    return this.bluetooth ? this.bluetooth.peers : 0
  }

  start() {
    return this.bluetooth ? this.bluetooth.start() : Promise.resolve()
  }

  setOnline(online) {
    if (this.bluetooth) this.bluetooth.setOnline(online)
  }

  async stop() {
    if (!this.bluetooth) return
    await this.bluetooth.stop()
  }
}

module.exports = BleTransport
