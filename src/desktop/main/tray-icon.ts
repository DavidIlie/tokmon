import { nativeImage, type NativeImage } from 'electron'
import { encodeTrayIconPng } from './tray-icon-raster'
import { trayIconSpec } from './tray-presentation'

function pngDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString('base64')}`
}

// The spec quantizes usage to 12 ticks, so the whole icon space is ~100 distinct
// bitmaps. Rasterising (supersample + deflate) on every snapshot repaint is
// wasted work — cache by the quantized spec identity instead.
const iconCache = new Map<string, NativeImage>()
const ICON_CACHE_LIMIT = 128

export function createTrayIcon(usedPct: number | null, critical: boolean, updateReady = false): NativeImage {
  const spec = trayIconSpec(usedPct, critical, updateReady)
  const key = `${spec.litTicks}|${spec.critical}|${spec.available}|${spec.updateReady}`
  const cached = iconCache.get(key)
  if (cached) return cached
  // NativeImage data URLs support PNG/JPEG, not SVG. Supplying an SVG here
  // creates a valid Tray with an empty bitmap: the title appears, the ring does
  // not. Build explicit PNG representations so the status item survives both
  // Retina rasterisation and template-image tinting.
  const image = nativeImage.createEmpty()
  image.addRepresentation({
    scaleFactor: 1,
    dataURL: pngDataUrl(encodeTrayIconPng(spec, spec.pointSize)),
  })
  image.addRepresentation({
    scaleFactor: 2,
    dataURL: pngDataUrl(encodeTrayIconPng(spec, spec.pointSize * 2)),
  })
  if (process.platform === 'darwin') image.setTemplateImage(true)
  if (iconCache.size >= ICON_CACHE_LIMIT) iconCache.clear()
  iconCache.set(key, image)
  return image
}
