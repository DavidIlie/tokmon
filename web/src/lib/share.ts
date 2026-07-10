import { toBlob, toPng } from 'html-to-image'
export { shareFilename } from './share-filename'

const BG = '#0a0a0a'

interface CaptureOpts {
  pixelRatio?: number
  backgroundColor?: string
}

async function settle(): Promise<void> {
  try { await document.fonts.ready } catch {}
  await new Promise(r => requestAnimationFrame(() => r(null)))
}

async function render(node: HTMLElement, opts: CaptureOpts = {}): Promise<string> {
  await settle()
  return toPng(node, {
    pixelRatio: opts.pixelRatio ?? 2,
    backgroundColor: opts.backgroundColor ?? BG,
    cacheBust: true,
    skipFonts: false,
  })
}

function triggerDownload(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export async function downloadNode(node: HTMLElement, filename: string, opts?: CaptureOpts): Promise<void> {
  triggerDownload(await render(node, opts), filename)
}

export async function copyNode(node: HTMLElement, opts?: CaptureOpts): Promise<boolean> {
  try {
    await settle()
    const blob = await toBlob(node, {
      pixelRatio: opts?.pixelRatio ?? 2,
      backgroundColor: opts?.backgroundColor ?? BG,
      cacheBust: true,
    })
    if (!blob || !navigator.clipboard || typeof ClipboardItem === 'undefined') return false
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}
