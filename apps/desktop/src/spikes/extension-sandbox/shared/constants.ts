// T-015 spike constants shared by the Electron host side and the spike debug page. This folder is
// evidence code, not product code: it is built only with MORTISE_SPIKE_BUILD=1 and the main process
// runs it only when MORTISE_SPIKE=extension-sandbox and the app is not packaged.

/** The privileged scheme an extension package is served from. */
export const EXTENSION_SCHEME = "mortise-ext"

/** The sample extension's manifest id, which doubles as the scheme host. */
export const EXTENSION_ID = "acme.tasks"

/** The sample view's package-relative entry file. */
export const EXTENSION_VIEW_PATH = "view/index.html"

/** The exact CSP served with every extension file. */
export const EXTENSION_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'"

/** Electron privileges the scheme is registered with. Standard and secure make it a real origin. */
export const EXTENSION_SCHEME_PRIVILEGES = {
  scheme: EXTENSION_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: false,
    bypassCSP: false,
  },
} as const

/** The URL the sandboxed iframe loads. */
export function extensionViewUrl(): string {
  return `${EXTENSION_SCHEME}://${EXTENSION_ID}/${EXTENSION_VIEW_PATH}`
}
