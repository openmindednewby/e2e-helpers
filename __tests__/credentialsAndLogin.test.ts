import type { Page } from '@playwright/test';

import { bffLogin, fixedTenantCredentials } from '../src';

const VALUE_A = 'value-one';
const VALUE_B = 'value-two';
const ENV_KEYS = ['APP_A_USERNAME', 'APP_A_PASSWORD', 'APP_B_USERNAME', 'APP_B_PASSWORD'];

function pageReplying(status: number, body: string): { page: Page; requests: { url: string; init: RequestInit }[] } {
  const requests: { url: string; init: RequestInit }[] = [];
  const page = {
    evaluate: (fn: (arg: unknown) => Promise<unknown>, arg: unknown) => {
      global.fetch = ((url: string, init: RequestInit) => {
        requests.push({ url, init });
        return Promise.resolve({ status, text: () => Promise.resolve(body) });
      }) as unknown as typeof fetch;
      return fn(arg);
    },
  } as unknown as Page;
  return { page, requests };
}

describe('fixedTenantCredentials', () => {
  afterEach(() => ENV_KEYS.forEach((key) => delete process.env[key]));

  it('with one prefix set, reads both values', () => {
    process.env.APP_A_USERNAME = 'alice';
    process.env.APP_A_PASSWORD = VALUE_A;

    const creds = fixedTenantCredentials('APP_A');

    expect(creds).toEqual({ username: 'alice', password: VALUE_A });
  });

  it('with two prefixes, falls back per value to the later prefix', () => {
    process.env.APP_A_USERNAME = 'alice';
    process.env.APP_B_USERNAME = 'bob';
    process.env.APP_B_PASSWORD = VALUE_B;

    const creds = fixedTenantCredentials('APP_A', 'APP_B');

    expect(creds).toEqual({ username: 'alice', password: VALUE_B });
  });

  it('with nothing set, returns empty strings', () => {
    const creds = fixedTenantCredentials('APP_A');

    expect(creds).toEqual({ username: '', password: '' });
  });
});

describe('bffLogin', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('on 200, posts the credentials with the CSRF header and resolves', async () => {
    const { page, requests } = pageReplying(200, '{}');

    await bffLogin(page, { username: 'alice', password: VALUE_A });

    expect(requests).toEqual([
      {
        url: '/bff/login',
        init: {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-BFF-Csrf': '1' },
          body: JSON.stringify({ username: 'alice', password: VALUE_A }),
        },
      },
    ]);
  });

  it('on 401, throws with the status, username and body', async () => {
    const { page } = pageReplying(401, 'nope');

    const login = bffLogin(page, { username: 'alice', password: VALUE_B });

    await expect(login).rejects.toThrow("bffLogin: POST /bff/login → 401 for 'alice': nope");
  });
});
