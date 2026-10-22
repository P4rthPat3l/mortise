/** Requests a callback once per animation frame. Injected so tests need no display. */
export interface FrameScheduler {
  schedule(callback: () => void): void
}

const raf: FrameScheduler = {
  schedule(callback) {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => callback())
      return
    }
    setTimeout(callback, 0)
  },
}

/** The default scheduler: `requestAnimationFrame` in a window, a task otherwise. */
export const frameScheduler: FrameScheduler = raf
