import { deflateSync } from 'node:zlib'
import type { TrayIconSpec } from './tray-presentation'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  return crc >>> 0
})

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii')
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.allocUnsafe(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}

function sampleAlpha(spec: TrayIconSpec, x: number, y: number): number {
  const dx = x - 8
  const dy = y - 8
  let alpha = 0

  for (let index = 0; index < spec.tickCount; index += 1) {
    const angle = -index * Math.PI * 2 / spec.tickCount
    const localX = dx * Math.cos(angle) - dy * Math.sin(angle)
    const localY = dx * Math.sin(angle) + dy * Math.cos(angle)
    if (Math.abs(localX) <= 0.82 && localY >= -7.4 && localY <= -4.15) {
      alpha = Math.max(alpha, index < spec.litTicks ? 1 : spec.unlitOpacity)
    }
  }

  if (spec.critical) {
    if ((Math.abs(dx) <= 0.72 && dy >= -2.9 && dy <= 2.0)
      || (Math.abs(dx) <= 0.78 && dy >= 3.05 && dy <= 4.45)) alpha = 1
  } else if (spec.available) {
    if (Math.abs(dx) <= 1.55 && Math.abs(dy) <= 1.55) alpha = 1
  } else if (Math.hypot(dx, dy) <= 1.2) {
    alpha = Math.max(alpha, 0.45)
  }

  if (spec.updateReady) {
    // A lower-right action badge is spatially distinct from the centre `!`
    // used for critical quota. Punch a halo first so the arrow stays legible.
    const badgeX = x - 12.4
    const badgeY = y - 12.2
    const distance = Math.hypot(badgeX, badgeY)
    if (distance <= 3.05) alpha = 0
    if (distance >= 2.0 && distance <= 2.65) alpha = 1
    if (
      (Math.abs(badgeX) <= 0.45 && badgeY >= -1.35 && badgeY <= 1.45)
      || (badgeY >= -1.55 && badgeY <= -0.75 && Math.abs(badgeX) <= 1.35 + badgeY * 0.55)
    ) alpha = 1
  }

  return alpha
}

export function rasterizeTrayIcon(spec: TrayIconSpec, pixels: number): Buffer {
  const scale = pixels / spec.pointSize
  const rgba = Buffer.alloc(pixels * pixels * 4)
  const samples = 4

  for (let y = 0; y < pixels; y += 1) {
    for (let x = 0; x < pixels; x += 1) {
      let alpha = 0
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          alpha += sampleAlpha(
            spec,
            (x + (sx + 0.5) / samples) / scale,
            (y + (sy + 0.5) / samples) / scale,
          )
        }
      }
      const offset = (y * pixels + x) * 4
      rgba[offset] = 255
      rgba[offset + 1] = 255
      rgba[offset + 2] = 255
      rgba[offset + 3] = Math.round(alpha / (samples * samples) * 255)
    }
  }

  return rgba
}

export function encodeTrayIconPng(spec: TrayIconSpec, pixels: number): Buffer {
  const rgba = rasterizeTrayIcon(spec, pixels)
  const scanlines = Buffer.alloc((pixels * 4 + 1) * pixels)
  for (let y = 0; y < pixels; y += 1) {
    const row = y * (pixels * 4 + 1)
    scanlines[row] = 0
    rgba.copy(scanlines, row + 1, y * pixels * 4, (y + 1) * pixels * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(pixels, 0)
  ihdr.writeUInt32BE(pixels, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
