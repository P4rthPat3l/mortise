// Architecture boundaries. Each rule mirrors a line in AGENTS.md "Dependency rules" and docs/architecture/overview.md 6.3.
// Run with `bun run check:deps`. If a rule blocks you, the design is telling you something: ask before changing a rule.

// Bun installs packages under node_modules/.bun/<name>@<version>/node_modules/<name>/, so each pattern also matches
// a nested node_modules. Patterns avoid nested quantifiers, which dependency-cruiser rejects as unsafe.
const npm = (name) => `node_modules/${name}/|node_modules/.*/${name}/`
const OPENCODE = "node_modules/.*@opencode/"
const ELECTRON = npm("electron")
const REACT = `${npm("react")}|${npm("react-dom")}`

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Circular dependencies make lifetimes and initialization order unpredictable.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-unresolvable",
      comment: "Every import must resolve. Usually a typo or a missing dependency in package.json.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "domain-imports-nothing",
      comment: "@mortise/domain is the leaf of the graph: no packages, no Node, no DOM.",
      severity: "error",
      from: { path: "^packages/domain/" },
      to: { pathNot: "^packages/domain/" },
    },
    {
      name: "opencode-only-in-adapter-and-gateway",
      comment: "Only @mortise/engine-opencode and @mortise/gateway-core may know OpenCode exists (ADR-004).",
      severity: "error",
      from: { pathNot: "^(packages/(engine-opencode|gateway-core)/|scripts/)" },
      to: { path: OPENCODE },
    },
    {
      name: "adapter-uses-promise-client-only",
      comment:
        "The adapter uses the zero-Effect Promise root. No /effect (Effect RC), /solid (official app) or /service (gateway only).",
      severity: "error",
      from: { path: "^packages/engine-opencode/" },
      to: { path: "@opencode/client/dist/(effect|solid)/|@opencode/client/dist/promise/service" },
    },
    {
      name: "adapter-imports-domain-only",
      comment: "Among workspace packages, the adapter depends on @mortise/domain only.",
      severity: "error",
      from: { path: "^packages/engine-opencode/" },
      to: { path: "^packages/", pathNot: "^packages/(engine-opencode|domain)/" },
    },
    {
      name: "gateway-core-is-host-neutral",
      comment:
        "gateway-core must run unchanged in Electron main and in a Node server (C11). No Electron, React or UI packages.",
      severity: "error",
      from: { path: "^packages/gateway-core/" },
      to: { path: `${ELECTRON}|${REACT}|^packages/(engine-opencode|core|sdk|ui|workbench)/|^apps/` },
    },
    {
      name: "rpc-contracts-imports-domain-only",
      comment: "Contracts are shared by both ends of the channel and stay minimal.",
      severity: "error",
      from: { path: "^packages/rpc-contracts/" },
      to: { path: "^packages/", pathNot: "^packages/(rpc-contracts|domain)/" },
    },
    {
      name: "framework-free-packages",
      comment: "domain, rpc-contracts, engine-opencode, gateway-core and core never import React.",
      severity: "error",
      from: { path: "^packages/(domain|rpc-contracts|engine-opencode|gateway-core|core)/" },
      to: { path: REACT },
    },
    {
      name: "core-boundaries",
      comment: "The core knows the domain model and nothing about the engine, the gateway or the UI.",
      severity: "error",
      from: { path: "^packages/core/" },
      to: { path: "^packages/", pathNot: "^packages/(core|domain)/" },
    },
    {
      name: "sdk-boundaries",
      comment: "The module SDK builds on core and domain only.",
      severity: "error",
      from: { path: "^packages/sdk/" },
      to: { path: "^packages/", pathNot: "^packages/(sdk|core|domain)/" },
    },
    {
      name: "ui-is-standalone",
      comment: "The design system must not read application state.",
      severity: "error",
      from: { path: "^packages/ui/" },
      to: { path: "^packages/", pathNot: "^packages/ui/" },
    },
    {
      name: "workbench-never-touches-gateway",
      comment: "The UI talks to the gateway through a Channel only, never by importing gateway-core.",
      severity: "error",
      from: { path: "^packages/workbench/" },
      to: { path: "^packages/gateway-core/|^apps/" },
    },
    {
      name: "adapter-only-from-composition-root",
      comment: "Inside the workbench, only src/bootstrap/ may create the engine adapter.",
      severity: "error",
      from: { path: "^packages/workbench/", pathNot: "^packages/workbench/src/bootstrap/" },
      to: { path: "^packages/engine-opencode/" },
    },
    {
      name: "modules-import-peers-through-contracts",
      comment: "A feature module may import another module's contract.ts and nothing else from it.",
      severity: "error",
      from: { path: "^packages/workbench/src/modules/([^/]+)/" },
      to: {
        path: "^packages/workbench/src/modules/[^/]+/",
        pathNot: ["^packages/workbench/src/modules/$1/", "^packages/workbench/src/modules/[^/]+/contract\\.ts$"],
      },
    },
    {
      name: "modules-do-not-import-core-directly",
      comment: "Feature modules use @mortise/sdk, which wraps the core.",
      severity: "error",
      from: { path: "^packages/workbench/src/modules/" },
      to: { path: "^packages/core/" },
    },
    {
      name: "electron-only-in-desktop-host",
      comment: "Electron APIs stay in apps/desktop main and preload.",
      severity: "error",
      from: { pathNot: "^apps/desktop/(src/(main|preload)/|electron\\.vite\\.config\\.ts$)" },
      to: { path: ELECTRON },
    },
    {
      name: "no-node-in-browser-code",
      comment: "Renderer-side code runs sandboxed and must not use Node built-ins.",
      severity: "error",
      from: {
        path: "^(apps/desktop/src/renderer/|packages/(workbench|sdk|ui|engine-opencode|core|domain|rpc-contracts)/)",
      },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "main-and-renderer-are-separate",
      comment: "Main and renderer share code only through workspace packages.",
      severity: "error",
      from: { path: "^apps/desktop/src/(main|preload)/" },
      to: { path: "^apps/desktop/src/renderer/|^packages/(workbench|sdk|ui|core|engine-opencode)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Only this repo's build output. A broader pattern would also hide imports that resolve into node_modules/*/dist.
    exclude: { path: "^(apps|packages)/[^/]+/(out|dist|coverage)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
      mainFields: ["module", "main", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
}
