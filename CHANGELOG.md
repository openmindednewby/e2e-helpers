# Changelog

All notable changes to `@dloizides/e2e-helpers` are documented here.

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
