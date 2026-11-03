# Changelog

All notable changes to `@dloizides/e2e-helpers` are documented here.

## [1.2.0] - 2026-11-03

### Added
- `bffLogin(page, creds)`: same-origin `POST /bff/login` from inside the page (E2E-STD-1 "One E2E standard").
- `fixedTenantCredentials(...envPrefixes)`: reads `<PREFIX>_USERNAME` / `<PREFIX>_PASSWORD`, first prefix that sets each.
- `RealTenantGuard`: refuses test writes and logins on protected tenants; slugs, host patterns, session probe paths and advice text are options. TEST-TENANT-1 "Tests never write to a real customer tenant".

### Changed
- The package entry now imports `@playwright/test` at runtime (for `RealTenantGuard`); it stays a peer dependency.
- Dev dependency `@playwright/test` pinned to 1.57.0, the version `RealTenantGuard.install()` patches; 1.62.1 has no `playwright-core/lib/client` and throws at install.

## [1.1.0] - 2026-10-25

### Added
- `expectFieldsAligned(page, rowLocator, { tolerancePx, controlSelector })` (D-ALL-22 "Horizontal form fields are aligned"): for each matched row, every visible input/select/textarea/button shares the row median top and height within `tolerancePx` (default 1); throws listing each offender. A locator matching no row fails instead of passing. Pure core `findMisalignedControls` + `formatMisalignment` exported.

## [1.0.0] - 2026-08-19

### Added
- Initial release — generic Playwright E2E helpers extracted from the per-product `*-helpers.ts`
  files (E2E-1, the shared vehicle for the two-tier `@api`/`@ui` standard):
  - `resolveBaseUrl`, `tryRequest`, `bearer`, `jsonAuth`
  - `resolveKeycloakBaseUrl`, `getRealmToken` (ROPC)
  - `waitForHealthy`, `deriveUsername`, `uniqueEmail`, `csvMultipart`
- `@playwright/test` as a peer dependency (never bundled).
