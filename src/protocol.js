'use strict'

const b4a = require('b4a')

const MAX_FRAME_BYTES = 64 * 1024
const MAX_TEXT_BYTES = 4 * 1024
const MAX_AUTHOR_BYTES = 128
const MAX_ID_BYTES = 128

function byteLength(value) {
  return b4a.byteLength(value, 'utf8')
}

function isHex(value, bytes) {
  return (
    typeof value === 'string' &&
    value.length === bytes * 2 &&
    /^[0-9a-f]+$/i.test(value)
  )
}

function hasUnsafeTerminalCharacters(value) {
  return /[\u0000-\u001f\u007f]/.test(value)
}

function validateChat(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return 'frame must contain an object'
  }
  if (message.type !== 'chat') return 'unsupported message type'
  if (
    typeof message.id !== 'string' ||
    message.id.length === 0 ||
    byteLength(message.id) > MAX_ID_BYTES
  ) {
    return 'invalid message id'
  }
  if (
    typeof message.author !== 'string' ||
    message.author.trim().length === 0 ||
    hasUnsafeTerminalCharacters(message.author) ||
    byteLength(message.author) > MAX_AUTHOR_BYTES
  ) {
    return 'invalid author'
  }
  if (!isHex(message.authorKey, 32)) return 'invalid author public key'
  if (
    typeof message.text !== 'string' ||
    message.text.length === 0 ||
    hasUnsafeTerminalCharacters(message.text) ||
    byteLength(message.text) > MAX_TEXT_BYTES
  ) {
    return 'invalid message text'
  }
  if (
    !Number.isSafeInteger(message.createdAt) ||
    message.createdAt < 0
  ) {
    return 'invalid creation time'
  }
  return null
}

function encodeFrame(message) {
  const error = validateChat(message)
  if (error) throw new Error(error)
  const frame = b4a.from(JSON.stringify(message) + '\n')
  if (frame.byteLength > MAX_FRAME_BYTES) throw new Error('frame is too large')
  return frame
}

class FrameDecoder {
  constructor({ onFrame, onError, maxFrameBytes = MAX_FRAME_BYTES }) {
    this.onFrame = onFrame
    this.onError = onError
    this.maxFrameBytes = maxFrameBytes
    this.buffer = b4a.alloc(0)
    this.discarding = false
  }

  push(chunk) {
    if (typeof chunk === 'string') chunk = b4a.from(chunk)
    else if (!b4a.isBuffer(chunk)) chunk = b4a.from(chunk)

    let offset = 0
    while (offset < chunk.byteLength) {
      const newline = chunk.indexOf(10, offset)

      if (this.discarding) {
        if (newline === -1) return
        this.discarding = false
        offset = newline + 1
        continue
      }

      if (newline === -1) {
        const tail = chunk.subarray(offset)
        if (this.buffer.byteLength + tail.byteLength > this.maxFrameBytes) {
          this.buffer = b4a.alloc(0)
          this.discarding = true
          this._error(new Error('frame exceeds maximum size'))
        } else {
          this.buffer = this.buffer.byteLength
            ? b4a.concat([this.buffer, tail])
            : b4a.from(tail)
        }
        return
      }

      const part = chunk.subarray(offset, newline)
      const size = this.buffer.byteLength + part.byteLength
      if (size > this.maxFrameBytes) {
        this.buffer = b4a.alloc(0)
        this._error(new Error('frame exceeds maximum size'))
      } else if (size > 0) {
        const line = this.buffer.byteLength
          ? b4a.concat([this.buffer, part])
          : part
        this.buffer = b4a.alloc(0)
        this._parse(line)
      } else {
        this.buffer = b4a.alloc(0)
      }
      offset = newline + 1
    }
  }

  end() {
    if (!this.discarding && this.buffer.byteLength > 0) {
      this._error(new Error('connection ended with a partial frame'))
    }
    this.buffer = b4a.alloc(0)
    this.discarding = false
  }

  _parse(line) {
    let message
    try {
      message = JSON.parse(line.toString('utf8'))
    } catch (error) {
      this._error(new Error('malformed JSON frame'))
      return
    }
    const error = validateChat(message)
    if (error) {
      this._error(new Error(error))
      return
    }
    this.onFrame(message)
  }

  _error(error) {
    if (this.onError) this.onError(error)
  }
}

module.exports = {
  FrameDecoder,
  MAX_FRAME_BYTES,
  MAX_TEXT_BYTES,
  encodeFrame,
  validateChat
}
