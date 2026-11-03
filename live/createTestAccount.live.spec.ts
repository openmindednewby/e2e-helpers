import { expect, request, test } from '@playwright/test';

import { createTestAccount } from '../src';

const JINX_URL = 'https://jinx-app.dloizides.com';
const LIVE_TIMEOUT_MS = 300_000;
const LOGIN_POLLS = 4;
const LOGIN_POLL_MS = 30_000;

test('live: a Jinx account is created, verified, signed in and disposed', async () => {
  test.setTimeout(LIVE_TIMEOUT_MS);

  const account = await createTestAccount({ app: 'jinx', baseUrl: JINX_URL });
  console.log(`created email=${account.email} tenantId=${account.tenantId}`);
  const me = await account.context.get('/bff/me');
  console.log(`session me=${String(me.status())} ${(await me.text()).slice(0, 300)}`);

  const disposed = await account.dispose();
  console.log(`disposed ${JSON.stringify(disposed)}`);

  const fresh = await request.newContext({ baseURL: JINX_URL, extraHTTPHeaders: { Origin: JINX_URL, 'X-BFF-Csrf': '1' } });
  for (let poll = 0; poll < LOGIN_POLLS; poll += 1) {
    const login = await fresh.post('/bff/login', { data: { username: account.email, password: account.password } });
    console.log(`login-after-dispose poll=${String(poll)} status=${String(login.status())}`);
    if (login.status() === 401) {break;}
    await new Promise(resolve => setTimeout(resolve, LOGIN_POLL_MS));
  }
  await fresh.dispose();
  expect(disposed.confirmStatus).toBe(200);
});
