'use strict'

const EventEmitter = require('bare-events')
const Hyperswarm = require('hyperswarm')

class HyperswarmTransport extends EventEmitter {
  constructor({ keyPair, topic, Swarm = Hyperswarm, swarmOptions = {} }) {
    super()
    this.keyPair = keyPair
    this.topic = topic
    this.Swarm = Swarm
    this.swarmOptions = swarmOptions
    this.swarm = null
    this.discovery = null
    this.state = 'off'
  }

  get peers() {
    return this.swarm ? this.swarm.connections.size : 0
  }

  async start() {
    if (this.swarm) return
    this.swarm = new this.Swarm({ ...this.swarmOptions, keyPair: this.keyPair })
    this.swarm.on('connection', (stream, info) => {
      this.emit('connection', stream, {
        remotePublicKey: info.publicKey || stream.remotePublicKey
      })
      this.emit('update')
    })
    this.swarm.on('update', () => this.emit('update'))
    this.swarm.on('error', (error) => this.emit('error', error))
    this.discovery = this.swarm.join(this.topic, { server: true, client: true })
    this.state = 'on'
    this.emit('update')
  }

  async stop({ force = false } = {}) {
    if (!this.swarm) {
      this.state = 'off'
      return
    }
    const swarm = this.swarm
    this.swarm = null
    this.discovery = null
    this.state = 'stopping'
    await swarm.destroy({ force })
    this.state = 'off'
    this.emit('update')
  }
}

module.exports = HyperswarmTransport
