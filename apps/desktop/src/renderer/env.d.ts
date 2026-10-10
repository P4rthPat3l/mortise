// Shape of the preload bridge. Keep in sync with src/preload/index.ts.
interface MortiseBridge {
  readonly platform: "desktop"
}

interface Window {
  readonly mortise: MortiseBridge
}
