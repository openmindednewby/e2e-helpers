import type { APIResponse } from '@playwright/test';

import { createTestAccount, loadBotMailboxConfig, TestAccountError, TestAccountStage } from '../src';
import type { CapturedEmail, TestAccountContext, TestAccountMailbox } from '../src';

const BASE_URL = 'https://app.example';
const DELETE_LINK = 'https://api.example/api/v1/privacy/delete-request/r1/confirm?token=del-1';
const VERIFY_MAIL_UID = 11;
const DELETE_MAIL_UID = 12;
const FORM_ELAPSED_MS = 4321;

interface Call {
  url: string;
  options: Record<string, unknown>;
}

function reply(status: number, body: unknown): APIResponse {
  const text = JSON.stringify(body);
  return { status: () => status, text: async () => text, json: async () => body } as unknown as APIResponse;
}

function fakeContext(replies: Record<string, APIResponse>): { context: TestAccountContext; calls: Call[]; disposed: () => boolean } {
  const calls: Call[] = [];
  let closed = false;
  const answer = async (url: string, options: Record<string, unknown> = {}): Promise<APIResponse> => {
    calls.push({ url, options });
    return replies[url] ?? reply(200, {});
  };
  const context = {
    post: answer,
    get: answer,
    dispose: async () => {
      closed = true;
    },
  } as unknown as TestAccountContext;
  return { context, calls, disposed: () => closed };
}

function fakeMailbox(): { mailbox: TestAccountMailbox; expunged: number[] } {
  const expunged: number[] = [];
  const mails: CapturedEmail[] = [
    { uid: VERIFY_MAIL_UID, subject: 'v', to: 'x', bodyText: `${BASE_URL}/verify-email?token=ver-1` },
    { uid: DELETE_MAIL_UID, subject: 'd', to: 'x', bodyText: DELETE_LINK },
  ];
  const mailbox: TestAccountMailbox = {
    waitForMessageTo: async (_to, options) => {
      const found = mails.find(mail => options?.matches?.(mail) ?? true);
      if (!found) {throw new Error('no mail');}
      return found;
    },
    expungeMessages: async uids => {
      expunged.push(...uids);
    },
  };
  return { mailbox, expunged };
}

function bodyOf(calls: Call[], url: string): Record<string, unknown> {
  return calls.find(call => call.url === url)?.options.data as Record<string, unknown>;
}

const SIGNED_UP = {
  '/bff/register': reply(202, { code: 'ACCEPTED' }),
  '/bff/verify-and-login': reply(200, { user: { tenantId: 't-1' } }),
};

describe('createTestAccount', () => {
  it('a new signup, posts the form shape with formElapsedMs and redeems the emailed token', async () => {
    const { context, calls } = fakeContext(SIGNED_UP);
    const { mailbox, expunged } = fakeMailbox();

    const account = await createTestAccount({ app: 'jinx', baseUrl: BASE_URL, mailbox, newContext: async () => context, formElapsedMs: FORM_ELAPSED_MS });

    const register = bodyOf(calls, '/bff/register');
    expect(register.formElapsedMs).toBe(FORM_ELAPSED_MS);
    expect(register.website).toBe('');
    expect(register.email).toBe(account.email);
    expect(account.email).toMatch(/^e2e-bot\+reg-[a-z0-9]+@dloizides\.com$/);
    expect(register.verifyUrlTemplate).toBe(`${BASE_URL}/verify-email?token={token}`);
    expect(bodyOf(calls, '/bff/verify-and-login')).toEqual({ token: 'ver-1' });
    expect(account.tenantId).toBe('t-1');
    expect(expunged).toEqual([VERIFY_MAIL_UID]);
  });

  it('a refused signup, throws at the register stage with status and code', async () => {
    const { context } = fakeContext({ '/bff/register': reply(429, { code: 'RATE_LIMITED' }) });
    const { mailbox } = fakeMailbox();

    const created = createTestAccount({ app: 'jinx', baseUrl: BASE_URL, mailbox, newContext: async () => context });

    await expect(created).rejects.toMatchObject({ stage: TestAccountStage.Register, status: 429, code: 'RATE_LIMITED' });
  });

  it('a verify link answering 409, throws at the verify stage and carries the code', async () => {
    const { context } = fakeContext({
      '/bff/register': reply(202, {}),
      '/bff/verify-and-login': reply(409, { errorCode: 'NEW_PASSWORD_REQUIRED' }),
    });
    const { mailbox } = fakeMailbox();

    const created = createTestAccount({ app: 'jinx', baseUrl: BASE_URL, mailbox, newContext: async () => context });

    await expect(created).rejects.toMatchObject({ stage: TestAccountStage.VerifyAndLogin, code: 'NEW_PASSWORD_REQUIRED' });
  });
});

describe('dispose', () => {
  it('after a delete request, posts the emailed token to confirm-form and closes the context', async () => {
    const { context, calls, disposed } = fakeContext({
      ...SIGNED_UP,
      '/bff/account/delete-request': reply(202, { requestId: 'r1', scheduledDeletionDate: '2026-11-03' }),
    });
    const { mailbox, expunged } = fakeMailbox();
    const account = await createTestAccount({ app: 'jinx', baseUrl: BASE_URL, mailbox, newContext: async () => context });

    const result = await account.dispose();

    const confirmUrl = 'https://api.example/api/v1/privacy/delete-request/r1/confirm-form';
    expect(calls.find(call => call.url === confirmUrl)?.options.form).toEqual({ confirmationToken: 'del-1' });
    expect(result).toEqual({ requestId: 'r1', scheduledDeletionDate: '2026-11-03', confirmStatus: 200 });
    expect(expunged).toEqual([VERIFY_MAIL_UID, DELETE_MAIL_UID]);
    expect(disposed()).toBe(true);
  });

  it('called twice, runs the delete once', async () => {
    const { context, calls } = fakeContext({
      ...SIGNED_UP,
      '/bff/account/delete-request': reply(202, { requestId: 'r1', scheduledDeletionDate: 'd' }),
    });
    const { mailbox } = fakeMailbox();
    const account = await createTestAccount({ app: 'jinx', baseUrl: BASE_URL, mailbox, newContext: async () => context });

    await account.dispose();
    await account.dispose();

    expect(calls.filter(call => call.url === '/bff/account/delete-request')).toHaveLength(1);
  });

  it('a stale login, throws at the delete-request stage with the code and never confirms', async () => {
    const { context, calls } = fakeContext({
      ...SIGNED_UP,
      '/bff/account/delete-request': reply(403, { code: 'RECENT_AUTHENTICATION_REQUIRED' }),
    });
    const { mailbox } = fakeMailbox();
    const account = await createTestAccount({ app: 'jinx', baseUrl: BASE_URL, mailbox, newContext: async () => context });

    const disposal = account.dispose();

    await expect(disposal).rejects.toBeInstanceOf(TestAccountError);
    await expect(disposal).rejects.toMatchObject({ stage: TestAccountStage.DeleteRequest, code: 'RECENT_AUTHENTICATION_REQUIRED' });
    expect(calls.some(call => call.url.includes('confirm-form'))).toBe(false);
  });
});

describe('loadBotMailboxConfig', () => {
  const NAME = 'E2E_BOT_MAILBOX_PASSWORD';
  afterEach(() => {
    delete process.env[NAME];
  });

  it('with only the password set, fills the bot host, port and user', () => {
    process.env[NAME] = 'pw-1';

    const config = loadBotMailboxConfig();

    expect(config).toEqual({ host: 'mail.dloizides.com', port: 993, user: 'e2e-bot@dloizides.com', password: 'pw-1', secure: true });
  });

  it('with no password, throws naming the variable', () => {
    expect(() => loadBotMailboxConfig()).toThrow(NAME);
  });
});
