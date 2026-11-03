# @dloizides/e2e-helpers

Shared building blocks for the estate's two-tier (`@api` / `@ui`) Playwright E2E suites. Generic,
product-agnostic helpers extracted from the per-product `*-helpers.ts` files so a new product's E2E is
a thin wrapper, not another copy-paste.

`@playwright/test` is a **peer dependency** — the consuming E2E suite provides it.

## Install

```bash
npm i -D @dloizides/e2e-helpers
```

## API

| Helper | Purpose |
|--------|---------|
| `resolveBaseUrl(envVar, fallback)` | env-configurable base URL (trailing slashes trimmed) |
| `tryRequest(request, baseUrl, path, opts?)` | request that returns `null` on transport failure → `test.skip` gracefully |
| `bearer(token)` / `jsonAuth(token)` | auth headers (GET/DELETE vs JSON body) |
| `resolveKeycloakBaseUrl()` | derive KC base from `KEYCLOAK_URL` / `KEYCLOAK_ISSUER` |
| `getRealmToken(realm, opts)` | ROPC access token for a realm; `null` when unconfigured |
| `waitForHealthy(request, baseUrl, path, timeout?)` | poll a health path until 2xx |
| `deriveUsername(email)` / `uniqueEmail(prefix?)` | Keycloak-legal username + unique register email |
| `csvMultipart(csv, filename?)` | Playwright multipart body for a CSV upload (`file` field) |

- `bffLogin(page, creds)`: same-origin `POST /bff/login` from inside the page; throws with status and body preview.
- `fixedTenantCredentials(...envPrefixes)`: `<PREFIX>_USERNAME` / `<PREFIX>_PASSWORD`, first prefix that sets each.
- `new RealTenantGuard(options)`: `.install()` refuses test writes and logins on protected tenants; call it from `playwright.config.ts`. First `install()` in a process wins.
  `install()` patches `playwright-core/lib/client`, tested on Playwright 1.57.0; from 1.60 that folder is gone and `install()` throws `UnsupportedPlaywrightVersionError` naming the version and the supported range (`>=1.40.0 <1.60.0`). The other helpers do not touch it and work on 1.64.

## Example (`@api` spec)

```ts
import { expect, test } from '@playwright/test';
import { resolveBaseUrl, tryRequest } from '@dloizides/e2e-helpers';

const BASE = resolveBaseUrl('AML_API_URL', 'https://aml-screening.dloizides.com');

test('rejects an unauthenticated screening @aml-api', async ({ request }) => {
  const r = await tryRequest(request, BASE, '/v1/screenings/check', { method: 'POST', data: { fullName: 'x' } });
  if (!r) { test.skip(true, `service not reachable at ${BASE}`); return; }
  expect([401, 403]).toContain(r.response.status());
});
```

## Convention

Every network helper returns `null`/false on failure so specs **skip, not fail** where the target
isn't reachable — safe on the dev PC, meaningful on the nightly in-cluster runner.
