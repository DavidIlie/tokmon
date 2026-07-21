import { nativeImage, type NativeImage } from 'electron'
import { encodeTrayIconPng } from './tray-icon-raster'
import { trayIconSpec } from './tray-presentation'

function pngDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString('base64')}`
}

export function createTrayIcon(usedPct: number | null, critical: boolean, updateReady = false): NativeImage {
  const spec = trayIconSpec(usedPct, critical, updateReady)
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
  return image
}
