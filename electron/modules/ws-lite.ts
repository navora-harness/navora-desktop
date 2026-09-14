import http from 'node:http'
import crypto from 'node:crypto'
import type { Duplex } from 'node:stream'

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length
  let header: Buffer
  if (len < 126) {
    header = Buffer.alloc(2)
    header[0] = 0x80 | opcode
    header[1] = len
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeUInt32BE(0, 2)
    header.writeUInt32BE(len, 6)
  }
  return Buffer.concat([header, payload])
}

/** Minimal WebSocket server (text + binary, no external deps). */
export class WsLiteSocket {
  private closed = false
  private buf = Buffer.alloc(0)

  constructor(private socket: Duplex) {
    socket.on('data', (chunk: Buffer) => this.onData(chunk))
    socket.on('close', () => {
      this.closed = true
      this.onClose?.()
    })
    socket.on('error', () => {
      this.closed = true
    })
  }

  onMessage?: (text: string) => void
  onBinary?: (data: Buffer) => void
  onClose?: () => void

  send(text: string): void {
    if (this.closed) return
    try {
      this.socket.write(encodeFrame(0x1, Buffer.from(text, 'utf8')))
    } catch {
      /* ignore */
    }
  }

  sendBinary(data: Buffer): void {
    if (this.closed) return
    try {
      this.socket.write(encodeFrame(0x2, data))
    } catch {
      /* ignore */
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.socket.write(Buffer.from([0x88, 0x00]))
      this.socket.end()
    } catch {
      /* ignore */
    }
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk])
    while (this.buf.length >= 2) {
      const b0 = this.buf[0]
      const b1 = this.buf[1]
      const opcode = b0 & 0x0f
      const masked = (b1 & 0x80) !== 0
      let len = b1 & 0x7f
      let offset = 2
      if (len === 126) {
        if (this.buf.length < 4) return
        len = this.buf.readUInt16BE(2)
        offset = 4
      } else if (len === 127) {
        if (this.buf.length < 10) return
        len = Number(this.buf.readBigUInt64BE(2))
        offset = 10
      }
      const maskLen = masked ? 4 : 0
      if (this.buf.length < offset + maskLen + len) return
      let payload = this.buf.subarray(offset + maskLen, offset + maskLen + len)
      if (masked) {
        const mask = this.buf.subarray(offset, offset + 4)
        const out = Buffer.alloc(len)
        for (let i = 0; i < len; i++) out[i]! = payload[i]! ^ mask[i % 4]!
        payload = out
      }
      this.buf = this.buf.subarray(offset + maskLen + len)
      if (opcode === 0x8) {
        this.close()
        return
      }
      if (opcode === 0x9) {
        const pong = Buffer.alloc(2 + payload.length)
        pong[0] = 0x8a
        pong[1] = payload.length
        payload.copy(pong, 2)
        this.socket.write(pong)
        continue
      }
      if (opcode === 0x1) {
        this.onMessage?.(payload.toString('utf8'))
      } else if (opcode === 0x2) {
        this.onBinary?.(payload)
      }
    }
  }
}

export function acceptWebSocket(
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
): WsLiteSocket | null {
  const key = req.headers['sec-websocket-key']
  if (!key || typeof key !== 'string') {
    socket.destroy()
    return null
  }
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n',
  )
  if (head?.length) socket.unshift(head)
  return new WsLiteSocket(socket)
}
