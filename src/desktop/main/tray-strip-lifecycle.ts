/**
 * The native status item keeps its last validated composed image while React
 * paints newer data. A transient reconnect or repaint must never collapse its
 * width; only an explicit empty provider selection clears the composed strip.
 */
export class TrayStripLifecycle {
  #hasComposedImage = false

  get hasComposedImage(): boolean {
    return this.#hasComposedImage
  }

  accept(): void {
    this.#hasComposedImage = true
  }

  observePinSignature(signature: string | null): void {
    if (signature === '') this.#hasComposedImage = false
  }
}
