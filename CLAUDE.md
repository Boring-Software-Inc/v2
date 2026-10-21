## Commit Messages & Pull Requests

Commits use the conventional-commit shape: `fix: resolve auth token expiry`.
commitlint enforces it on the `commit-msg` hook (see `commitlint.config.ts`).
The hook is wired by `bun install`; `--no-verify` skips it.
