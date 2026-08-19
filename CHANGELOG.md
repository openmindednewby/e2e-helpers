# Changelog

All notable changes to `@dloizides/e2e-helpers` are documented here.

## [1.0.0] - 2026-08-19

### Added
- Initial release — generic Playwright E2E helpers extracted from the per-product `*-helpers.ts`
  files (E2E-1, the shared vehicle for the two-tier `@api`/`@ui` standard):
  - `resolveBaseUrl`, `tryRequest`, `bearer`, `jsonAuth`
  - `resolveKeycloakBaseUrl`, `getRealmToken` (ROPC)
  - `waitForHealthy`, `deriveUsername`, `uniqueEmail`, `csvMultipart`
- `@playwright/test` as a peer dependency (never bundled).
