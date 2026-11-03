import type { Page } from '@playwright/test';

import type { BffCredentials } from './fixedTenantCredentials';

const HTTP_OK = 200;
const BODY_PREVIEW_CHARS = 200;

/** Posts `/bff/login` from inside a page already on the app origin; throws with status and body preview. */
export async function bffLogin(page: Page, creds: BffCredentials): Promise<void> {
  const result = await page.evaluate(async ({ username, password }: BffCredentials) => {
    const res = await fetch('/bff/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-BFF-Csrf': '1' },
      body: JSON.stringify({ username, password }),
    });
    let body = '';
    try {
      body = await res.text();
    } catch {
      body = '';
    }
    return { status: res.status, body };
  }, creds);
  if (result.status !== HTTP_OK) {
    throw new Error(
      `bffLogin: POST /bff/login → ${result.status} for '${creds.username}': ${result.body.slice(0, BODY_PREVIEW_CHARS)}`,
    );
  }
}
