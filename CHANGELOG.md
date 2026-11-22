# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.5] - 2026-11-22

### Fixed

- Host compatibility range now includes DSH `0.2.1-rc.x` as well as `0.2.2-rc.x`.
  DSH 0.2.1 rejects `engines.dsh >=0.2.2-0`, so the previous manifest blocked
  installation even though the plugin runs on 0.2.1.
- README: state the supported DSH versions.

## [0.2.4] - 2026-11-16

### Fixed

- Bundle entry and client module identities now use the scoped npm package name,
  so the installed package resolves at runtime and its settings page pairs with
  the correct plugin row.

## [0.2.3] - 2026-11-16

### Changed

- npm package renamed to `@magic6/dsh-web-fallback-chain`; npm requires a scoped
  package for the first automated publish.
- README: update the npm installation command.

## [0.2.2] - 2026-11-16

### Added

- npm distribution: install with `dsh plugin --profile web add dsh-web-fallback-chain`.

### Changed

- README: document npm installation and use absolute links for the language switch.

## [0.2.1] - 2026-11-16

### Changed

- README: add a visible English / Simplified Chinese language switch.

## [0.2.0] - 2026-11-16

First public release.

### Changed

- Package and repository renamed to `dsh-web-fallback-chain`. The mounted entry id
  remains `web-fallback` so existing profile patches keep working.
- README rewritten with the measured ranking, free-only semantics, installation and
  configuration reference. Added a Chinese translation.
- Added CI, security policy and contribution guide.

### Verified

- `npm test`: 162 passing, 0 failing.
- Settings client rendered through `vm` with a fake module loader (see
  `test/client-render.test.js`).

Earlier internal versions (0.1.x) are preserved in the private development history.
