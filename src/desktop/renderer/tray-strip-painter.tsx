import React, { useEffect, useRef } from 'react'
import type { Config, WebSnapshot } from '../../web/contract'
import { usageFromHeadroom } from '../../usage-semantics'
import { markRenderPlan, providerMark, providerMonogram } from './provider-icons'
import {
  providerRepresentative,
  TRAY_STRIP,
  trayStripLayout,
  type TraySegmentValue,
} from './presentation'

function trayFont(): string {
  return `${TRAY_STRIP.fontWeight} ${TRAY_STRIP.fontPx}px -apple-system, system-ui, sans-serif`
}

function paintTrayStrip(canvas: HTMLCanvasElement, scale: number, values: readonly TraySegmentValue[], measure: (text: string) => number): number {
  const layout = trayStripLayout(values, measure)
  canvas.width = Math.max(1, Math.round(layout.width * scale))
  canvas.height = Math.round(TRAY_STRIP.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return layout.width
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  ctx.fillStyle = '#000'
  const {
    iconBox, centerY, baselineY, activeCenterX, activeCenterY,
    activeDotRadius, activeHaloRadius, unknownAlpha,
  } = TRAY_STRIP

  for (const segment of layout.segments) {
    const mark = providerMark(segment.providerId)
    ctx.save()
    if (mark) {
      const plan = markRenderPlan(mark, segment.iconX + iconBox / 2, centerY)
      ctx.translate(plan.offsetX, plan.offsetY)
      ctx.scale(plan.scale, plan.scale)
      ctx.fill(new Path2D(plan.path), plan.fillRule)
    } else {
      ctx.font = '600 9px -apple-system, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(providerMonogram(segment.providerId).slice(0, 2), segment.iconX + iconBox / 2, baselineY)
    }
    ctx.restore()

    ctx.save()
    ctx.font = trayFont()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.globalAlpha = segment.usage === null ? unknownAlpha : 1
    ctx.fillText(segment.label, segment.numCenterX, baselineY)
    ctx.restore()

    if (segment.active) {
      const centerX = segment.iconX + activeCenterX
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.beginPath()
      ctx.arc(centerX, activeCenterY, activeHaloRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
      ctx.beginPath()
      ctx.arc(centerX, activeCenterY, activeDotRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }
  return layout.width
}

export function TrayStripPainter({ snapshot, config, pins, platform, now }: {
  snapshot: WebSnapshot | null; config: Config; pins: string[]; platform: string; now: number
}) {
  const canvas1x = useRef<HTMLCanvasElement>(null)
  const canvas2x = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (platform !== 'darwin' || pins.length === 0 || !snapshot) return
    const canvas1 = canvas1x.current
    const canvas2 = canvas2x.current
    if (!canvas1 || !canvas2) return
    try {
      const values: TraySegmentValue[] = pins.map(providerId => {
        const provider = snapshot.providers.find(candidate => candidate.id === providerId)
        if (provider?.headroom) {
          return {
            providerId,
            usage: usageFromHeadroom(provider.headroom.value),
            active: provider.headroom.activeAccountIds.length > 0,
          }
        }
        const accounts = snapshot.accounts.filter(account => account.providerId === providerId)
        const representative = providerRepresentative(accounts, config.tray.activeTimeoutMin, now)
        return {
          providerId,
          usage: usageFromHeadroom(representative.quota?.remaining ?? null),
          active: representative.providerActive,
        }
      })
      const measureContext = document.createElement('canvas').getContext('2d')
      if (!measureContext) return
      measureContext.font = trayFont()
      const measure = (text: string) => measureContext.measureText(text).width
      const logicalWidth = paintTrayStrip(canvas1, 1, values, measure)
      paintTrayStrip(canvas2, 2, values, measure)
      void window.tokmon.sendTrayStrip({
        dataUrl1x: canvas1.toDataURL('image/png'),
        dataUrl2x: canvas2.toDataURL('image/png'),
        logicalWidth,
      })
    } catch {
      // The main process retains its procedural fallback icon.
    }
  }, [snapshot, pins, platform, config.tray.activeTimeoutMin, now])
  return (
    <>
      <canvas ref={canvas1x} className="tray-strip-canvas" aria-hidden="true" />
      <canvas ref={canvas2x} className="tray-strip-canvas" aria-hidden="true" />
    </>
  )
}
