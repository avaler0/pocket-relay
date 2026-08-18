'use strict'

const { paint, transportLine } = require('./format')

class TerminalPresenter {
  constructor({ output, colors = true }) {
    this.output = output
    this.colors = colors
    this.readline = null
  }

  attachReadline(readline) {
    this.readline = readline
  }

  line(text, color = null) {
    const rendered = color ? paint(text, color, this.colors) : text
    if (!this.readline) {
      this.output.write(rendered + '\r\n')
      return
    }

    // bare-readline has no public async-log method. Its current implementation
    // exposes the rendered-row counter used here to redraw an in-progress line.
    const rl = this.readline
    const columns = (rl.output && rl.output.columns) || 80
    const prompt = rl.getPrompt()
    const cursorRow = Math.floor((prompt.length + rl.cursor) / columns)
    const lastRow = Math.floor((prompt.length + rl.line.length) / columns)
    let clear = '\r'
    if (cursorRow) clear = `\u001b[${cursorRow}A\r`
    for (let row = 0; row <= lastRow; row++) {
      clear += '\u001b[2K'
      if (row < lastRow) clear += '\u001b[1B\r'
    }
    if (lastRow) clear += `\u001b[${lastRow}A\r`
    this.output.write(clear + rendered + '\r\n')
    rl._previousRows = 0
    rl.prompt()
  }

  delivery(event) {
    const line = transportLine(event)
    const color = event.duplicate ? 'duplicate' : event.transport
    this.line(line, color)
  }

  queued(message) {
    this.line(`[LOCAL/QUEUED] ${message.author}: ${message.text}`, 'local')
  }

  error(message) {
    this.line(`[ERROR] ${message}`, 'error')
  }
}

module.exports = TerminalPresenter
