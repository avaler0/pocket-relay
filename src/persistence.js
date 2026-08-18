'use strict'

const fs = require('bare-fs')
const path = require('bare-path')
const storage = require('bare-storage')
const crypto = require('hypercore-crypto')

async function readJSONL(filepath) {
  let contents
  try {
    contents = await fs.readFile(filepath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const result = []
  for (const line of contents.split('\n')) {
    if (!line.trim()) continue
    try {
      result.push(JSON.parse(line))
    } catch (_) {
      // An interrupted final append must not make the rest of the history unusable.
    }
  }
  return result
}

class JsonlPersistence {
  constructor({ baseDir = storage.persistent(), topicHex }) {
    this.appDir = path.join(baseDir, 'pocket-relay')
    this.roomDir = path.join(this.appDir, 'rooms', topicHex)
    this.seedPath = path.join(this.appDir, 'identity-seed')
    this.messagesPath = path.join(this.roomDir, 'messages.jsonl')
    this.deliveriesPath = path.join(this.roomDir, 'deliveries.jsonl')
    this.pending = Promise.resolve()
    this.closed = false
  }

  async open() {
    await fs.mkdir(this.roomDir, { recursive: true })
    return this
  }

  async loadOrCreateSeed() {
    try {
      const seed = await fs.readFile(this.seedPath)
      if (seed.byteLength !== 32) throw new Error('identity seed must be 32 bytes')
      return seed
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      const seed = crypto.randomBytes(32)
      try {
        await fs.writeFile(this.seedPath, seed, { mode: 0o600, flag: 'wx' })
        return seed
      } catch (writeError) {
        if (writeError.code !== 'EEXIST') throw writeError
        const existing = await fs.readFile(this.seedPath)
        if (existing.byteLength !== 32) throw new Error('identity seed must be 32 bytes')
        return existing
      }
    }
  }

  loadMessages() {
    return readJSONL(this.messagesPath)
  }

  loadDeliveries() {
    return readJSONL(this.deliveriesPath)
  }

  appendMessage(message) {
    return this._append(this.messagesPath, message)
  }

  appendDelivery(event) {
    return this._append(this.deliveriesPath, event)
  }

  _append(filepath, value) {
    if (this.closed) return Promise.reject(new Error('storage is closed'))
    const line = JSON.stringify(value) + '\n'
    const write = this.pending.then(() => fs.appendFile(filepath, line))
    this.pending = write.catch(() => {})
    return write
  }

  flush() {
    return this.pending
  }

  async close() {
    if (this.closed) return
    await this.pending
    this.closed = true
  }
}

module.exports = { JsonlPersistence, readJSONL }
