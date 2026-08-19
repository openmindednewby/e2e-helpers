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
