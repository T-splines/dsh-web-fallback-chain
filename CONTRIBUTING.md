# Contributing

Thanks for taking a look. This is a small, test-first project.

## Development

Requirements: Node.js 20+.

```bash
git clone https://github.com/T-splines/dsh-web-fallback-chain.git
cd dsh-web-fallback-chain
npm install --no-audit --no-fund   # peer dependencies provide the test imports
npm test
```

The test suite uses only `node --test` and local fixtures; there is no build step. Install
dependencies first: a fresh checkout has no `node_modules`, and the tests import the
declared peer packages.

## Pull requests

- Keep one logical change per commit. Use `feat:` / `fix:` / `test:` / `docs:` /
  `chore:` prefixes and explain *why* in the message.
- Add a regression test for every bug fix. The settings client is tested through a
  real `vm` evaluation, not static string checks.
- Do not add runtime dependencies without discussing it first: the plugin is meant to
  stay install-free inside a DSH profile.
- Update `CHANGELOG.md` for user-visible changes.
