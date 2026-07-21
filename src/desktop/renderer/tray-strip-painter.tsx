import React, { useEffect, useMemo, useRef } from 'react'
import type { Config, MenuBarConfig, WebSnapshot } from '../../web/contract'
import type { DesktopUpdateState } from '../shared/desktop-contract'
import {
  buildMenuBarPlan,
  menuBarValuesFromSnapshot,
  menuBarRenderSignature,
  type MenuBarPlan,
  type MenuBarSegmentValue,
} from '../shared/menu-bar-plan'
import { markRenderPlan, providerMark, providerMonogram } from './provider-icons'

function menuBarFont(plan: MenuBarPlan): string {
  return `500 ${plan.tokens.fontPx}px -apple-system, system-ui, sans-serif`
}

export function menuBarValues(
  snapshot: WebSnapshot,
  config: Config,
  pins: readonly string[],
): MenuBarSegmentValue[] {
  return menuBarValuesFromSnapshot(snapshot, config, pins)
}

/** Paint a precomputed production plan into a black-on-transparent template image. */
export function paintMenuBarStrip(canvas: HTMLCanvasElement, scale: number, plan: MenuBarPlan): number {
  canvas.width = Math.max(1, Math.round(plan.width * scale))
  canvas.height = Math.max(1, Math.round(plan.height * scale))
  canvas.style.width = `${plan.width}px`
  canvas.style.height = `${plan.height}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return plan.width
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  ctx.fillStyle = '#000'
  const hasProgress = plan.segments.some(segment => segment.showProgress)
  const centerY = hasProgress ? 9.75 : 11
  const baselineY = centerY + plan.tokens.fontPx * 0.36

  for (const segment of plan.segments) {
    if (segment.showProviderMark && segment.iconX !== null) {
      const mark = providerMark(segment.providerId)
      ctx.save()
      if (mark) {
        const render = markRenderPlan(mark, segment.iconX + plan.tokens.iconBox / 2, centerY)
        const densityScale = plan.tokens.iconBox / 13
        ctx.translate(render.offsetX, render.offsetY)
        ctx.scale(render.scale * densityScale, render.scale * densityScale)
        ctx.fill(new Path2D(render.path), render.fillRule)
      } else {
        ctx.font = `600 ${Math.max(8, plan.tokens.fontPx - 2)}px -apple-system, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(providerMonogram(segment.providerId).slice(0, 2), segment.iconX + plan.tokens.iconBox / 2, baselineY)
      }
      ctx.restore()
    }

    if (segment.showValue && segment.valueCenterX !== null) {
      ctx.save()
      ctx.font = menuBarFont(plan)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.globalAlpha = segment.label === '–' ? 0.45 : 1
      ctx.fillText(segment.label, segment.valueCenterX, baselineY)
      ctx.restore()
    }

    if (segment.showProgress && segment.progressX !== null && segment.progressY !== null) {
      ctx.save()
      ctx.globalAlpha = 0.24
      ctx.fillRect(segment.progressX, segment.progressY, plan.tokens.progressWidth, plan.tokens.progressHeight)
      if (segment.progressFraction !== null) {
        ctx.globalAlpha = 1
        ctx.fillRect(
          segment.progressX,
          segment.progressY,
          plan.tokens.progressWidth * segment.progressFraction,
          plan.tokens.progressHeight,
        )
      }
      ctx.restore()
    }

    if (segment.active) {
      const centerX = segment.iconX !== null
        ? segment.iconX + plan.tokens.iconBox - 0.5
        : segment.x + segment.width - 0.5
      const centerDotY = Math.max(3.5, centerY - plan.tokens.iconBox / 2 + 0.5)
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.beginPath()
      ctx.arc(centerX, centerDotY, 2.25, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
      ctx.beginPath()
      ctx.arc(centerX, centerDotY, 1.25, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  if (plan.updateCenterX !== null) {
    ctx.save()
    ctx.font = '700 11px -apple-system, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText('↑', plan.updateCenterX, 14.5)
    ctx.restore()
  }
  return plan.width
}

function measuredPlan(
  values: readonly MenuBarSegmentValue[],
  menuBar: MenuBarConfig,
  displayWidthPt: number,
  updateReady: boolean,
  availableWidthPt?: number,
): MenuBarPlan | null {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return null
  return buildMenuBarPlan({
    values,
    config: menuBar,
    displayWidthPt,
    updateReady,
    ...(availableWidthPt === undefined ? {} : { availableWidthPt }),
    measureText: (text, font) => {
      context.font = font
      return context.measureText(text).width
    },
  })
}

/**
 * Unstyled preview canvas. It uses the same plan and painter as the native strip;
 * callers own surrounding labels, backgrounds, and controls.
 */
export function MenuBarStripPreview({
  values,
  menuBar,
  displayWidthPt = 1440,
  availableWidthPt,
  updateReady = false,
  className,
  ariaLabel = 'Menu bar preview',
  onPlan,
}: {
  values: readonly MenuBarSegmentValue[]
  menuBar: MenuBarConfig
  displayWidthPt?: number
  availableWidthPt?: number
  updateReady?: boolean
  className?: string
  ariaLabel?: string
  onPlan?(plan: MenuBarPlan | null): void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const dependency = JSON.stringify({ values, menuBar, displayWidthPt, availableWidthPt, updateReady })
  const plan = useMemo(
    () => measuredPlan(values, menuBar, displayWidthPt, updateReady, availableWidthPt),
    // `dependency` deliberately includes every builder leaf and segment leaf.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dependency],
  )
  useEffect(() => {
    if (!canvas.current || !plan) return
    paintMenuBarStrip(canvas.current, Math.max(1, window.devicePixelRatio || 1), plan)
  }, [plan])
  useEffect(() => onPlan?.(plan), [onPlan, plan])
  return <canvas ref={canvas} className={className} role="img" aria-label={ariaLabel} />
}

export function TrayStripPainter({ snapshot, config, pins, platform, update, displayWidthPt }: {
  snapshot: WebSnapshot | null
  config: Config
  pins: string[]
  platform: string
  update: DesktopUpdateState
  displayWidthPt?: number
}) {
  const canvas1x = useRef<HTMLCanvasElement>(null)
  const canvas2x = useRef<HTMLCanvasElement>(null)
  const menuBarDependency = JSON.stringify(config.tray.menuBar)
  const effectiveDisplayWidth = displayWidthPt ?? window.screen.availWidth
  useEffect(() => {
    if (platform !== 'darwin' || pins.length === 0 || !snapshot) return
    const canvas1 = canvas1x.current
    const canvas2 = canvas2x.current
    if (!canvas1 || !canvas2) return
    try {
      const values = menuBarValues(snapshot, config, pins)
      const updateReady = update.status === 'downloaded'
      const plan = measuredPlan(values, config.tray.menuBar, effectiveDisplayWidth, updateReady)
      if (!plan) return
      const logicalWidth = paintMenuBarStrip(canvas1, 1, plan)
      paintMenuBarStrip(canvas2, 2, plan)
      void window.tokmon.sendTrayStrip({
        dataUrl1x: canvas1.toDataURL('image/png'),
        dataUrl2x: canvas2.toDataURL('image/png'),
        logicalWidth,
        updateReady,
        configRevision: config.revision,
        snapshotGeneratedAt: snapshot.generatedAt,
        pinSignature: pins.join(String.fromCharCode(0)),
        displayWidthPt: effectiveDisplayWidth,
        renderSignature: menuBarRenderSignature({
          configRevision: config.revision,
          snapshotGeneratedAt: snapshot.generatedAt,
          values,
          config: config.tray.menuBar,
          valueMode: config.tray.menuBarValue,
          displayWidthPt: effectiveDisplayWidth,
          updateReady,
          updateStatus: update.status,
        }),
      })
    } catch {
      // The main process retains its procedural fallback icon.
    }
  }, [
    snapshot, pins, platform, config.revision, config.tray.activeTimeoutMin,
    config.tray.menuBarValue, menuBarDependency, update.status, effectiveDisplayWidth,
  ])
  return (
    <>
      <canvas ref={canvas1x} className="tray-strip-canvas" aria-hidden="true" />
      <canvas ref={canvas2x} className="tray-strip-canvas" aria-hidden="true" />
    </>
  )
}
