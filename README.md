# Mortise

An extensible desktop workspace for [OpenCode](https://opencode.ai) v2 agents.

> Mortise is an independent project. It is not built by the OpenCode team and is not affiliated with them in any way.
> "Mortise" is a working name.

**Status:** pre-alpha. The repository holds the architecture, the backlog, and a building skeleton. Nothing user-facing works yet.

## Requirements

- [Bun](https://bun.com) 1.4
- Node.js 24
- OpenCode v2.0.20 to v2.0.x, installed separately (`opencode --version`). Mortise does not bundle the engine.

## Quick start

```bash
bun install
bun run check     # lint, typecheck, architecture rules, tests
bun run dev       # open the desktop app
```

### Linux: allow Electron's sandbox (one-time)

Ubuntu 24.04 and later restrict unprivileged user namespaces, so Electron aborts with "The SUID sandbox helper binary was found, but is not configured correctly". Never work around this with `--no-sandbox`; Mortise depends on the renderer sandbox. Instead, give the development Electron binary an AppArmor profile once. Run this from the repository root:

```bash
sudo tee /etc/apparmor.d/mortise-electron-dev >/dev/null <<EOF
abi <abi/4.0>,
include <tunables/global>
profile mortise-electron-dev $PWD/node_modules/.bun/electron@*/node_modules/electron/dist/electron flags=(unconfined) {
  userns,
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/mortise-electron-dev
```

The glob keeps working across Electron upgrades. The alternative is `sudo chown root:root` plus `sudo chmod 4755` on `.../electron/dist/chrome-sandbox`, which has to be repeated after every reinstall.

## Layout

| Path | What it is |
| --- | --- |
| `apps/desktop` | Electron host |
| `packages/*` | Domain model, engine adapter, gateway, core, module SDK, design system, workbench UI |
| `docs/` | Architecture, decisions, engine contract reference, feature documents |
| `tasks/` | The backlog, written so that coding agents can pick up work |

Start with [`docs/README.md`](docs/README.md). Contributors and coding agents must read [`AGENTS.md`](AGENTS.md).

## License

Not chosen yet.
