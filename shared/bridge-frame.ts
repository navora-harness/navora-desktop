/** Binary remote frame: BRF1 header + JPEG payload (shared by main + web client). */

export function parseBridgeFrame(buf: Buffer | ArrayBuffer | Uint8Array): {
  contentW: number
  contentH: number
  imageW: number
  imageH: number
  jpeg: Uint8Array
} | null {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf as ArrayBuffer)
  if (u8.length < 14) return null
  const magic = String.fromCharCode(u8[0]!, u8[1]!, u8[2]!, u8[3]!)
  if (magic !== 'BRF1') return null
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  return {
    contentW: view.getUint16(6),
    contentH: view.getUint16(8),
    imageW: view.getUint16(10),
    imageH: view.getUint16(12),
    jpeg: u8.subarray(14),
  }
}
