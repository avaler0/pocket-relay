'use strict'

const b4a = require('b4a')
const crypto = require('hypercore-crypto')
const createTestnet = require('@hyperswarm/testnet')
const HyperswarmTransport = require('../src/transports/hyperswarm')

const topic = crypto.randomBytes(32)
let testnet = null
let a = null
let b = null
let timer = null
let stopping = false

async function stop(code) {
  if (stopping) return
  stopping = true
  if (timer) clearTimeout(timer)
  if (a || b) {
    await Promise.all([
      a ? a.stop({ force: code !== 0 }) : null,
      b ? b.stop({ force: code !== 0 }) : null
    ])
  }
  if (testnet) await testnet.destroy()
  Bare.exit(code)
}

async function main() {
  testnet = await createTestnet(3)
  const swarmOptions = { bootstrap: testnet.bootstrap }
  a = new HyperswarmTransport({ keyPair: crypto.keyPair(), topic, swarmOptions })
  b = new HyperswarmTransport({ keyPair: crypto.keyPair(), topic, swarmOptions })

  a.on('error', (error) => console.error(error))
  b.on('error', (error) => console.error(error))
  b.on('connection', (stream) => {
    stream.once('data', (data) => {
      if (b4a.toString(data) !== 'pocket-relay-smoke') {
        console.error('Unexpected smoke-test payload')
        stop(1)
        return
      }
      console.log('Hyperswarm smoke passed: two Bare peers discovered and exchanged data.')
      stop(0)
    })
  })
  a.on('connection', (stream) => stream.write('pocket-relay-smoke'))

  await a.start()
  await a.discovery.flushed()
  await b.start()
  timer = setTimeout(() => {
    console.error('Hyperswarm smoke timed out after 20 seconds')
    stop(1)
  }, 20000)
}

main().catch((error) => {
  console.error(error)
  stop(1)
})
