import { randomBytes } from 'node:crypto';

import { request } from '@playwright/test';

import { BotMailbox, loadBotMailboxConfig } from './botMailbox';
import { extractLink, tokenOfLink, type CapturedEmail } from './mailMessage';
import {
  TestAccountError,
  TestAccountStage,
  type APIResponse,
  type CreateTestAccountOptions,
  type DisposedTestAccount,
  type TestAccount,
  type TestAccountContext,
  type TestAccountMailbox,
} from './testAccountTypes';

const HTTP_OK = 200;
const HTTP_ACCEPTED = 202;
const ID_BYTES = 6;
const BODY_PREVIEW_CHARS = 200;
const DEFAULT_FORM_ELAPSED_MS = 8000;
const MAILBOX_TIMEOUT_MS = 120_000;
const BOT_DOMAIN = 'dloizides.com';
const DELETION_LINK_FRAGMENT = '/privacy/delete-request/';
const VERIFY_LINK_FRAGMENT = '/verify-email';

function newRunIdentity(app: string): { email: string; password: string; tenantName: string; username: string } {
  const id = randomBytes(ID_BYTES).toString('hex');
  const stamp = Date.now().toString(36);
  return {
    email: `e2e-bot+reg-${stamp}${id}@${BOT_DOMAIN}`,
    username: `e2e-bot-reg-${stamp}${id}`,
    password: `E2e-${randomBytes(ID_BYTES).toString('hex')}-Aa1`,
    tenantName: `${app} e2e ${stamp}${id}`,
  };
}

async function failureOf(stage: TestAccountStage, response: APIResponse): Promise<TestAccountError> {
  const text = await response.text().catch(() => '');
  let code: string | undefined;
  try {
    const body = JSON.parse(text) as { code?: string; errorCode?: string };
    code = body.code ?? body.errorCode;
  } catch {
    code = undefined;
  }
  return new TestAccountError(stage, `HTTP ${String(response.status())}: ${text.slice(0, BODY_PREVIEW_CHARS)}`, response.status(), code);
}

function defaultMailbox(): TestAccountMailbox {
  return new BotMailbox(loadBotMailboxConfig(), { timeoutMs: MAILBOX_TIMEOUT_MS });
}

function defaultContext(baseUrl: string): Promise<TestAccountContext> {
  return request.newContext({ baseURL: baseUrl, extraHTTPHeaders: { Origin: baseUrl, 'X-BFF-Csrf': '1' } });
}

async function readMail(
  mailbox: TestAccountMailbox,
  stage: TestAccountStage,
  to: string,
  fragment: string,
): Promise<{ mail: CapturedEmail; link: string }> {
  const mail = await mailbox
    .waitForMessageTo(to, { matches: email => extractLink(email, fragment) !== null })
    .catch((error: unknown) => {
      throw new TestAccountError(stage, error instanceof Error ? error.message : String(error));
    });
  return { mail, link: extractLink(mail, fragment) ?? '' };
}

function requireToken(stage: TestAccountStage, link: string): string {
  const token = tokenOfLink(link);
  if (token === null) {throw new TestAccountError(stage, 'the emailed link carries no token');}
  return token;
}

async function readTenantId(context: TestAccountContext, verified: APIResponse): Promise<string> {
  const body = (await verified.json().catch(() => ({}))) as { user?: { tenantId?: string } };
  if (body.user?.tenantId) {return body.user.tenantId;}
  const me = await context.get('/bff/me');
  const session = (await me.json().catch(() => ({}))) as { tenantId?: string };
  return session.tenantId ?? '';
}

async function deleteAccount(
  context: TestAccountContext,
  mailbox: TestAccountMailbox,
  email: string,
): Promise<DisposedTestAccount> {
  const requested = await context.post('/bff/account/delete-request', { data: {} });
  if (requested.status() !== HTTP_ACCEPTED) {throw await failureOf(TestAccountStage.DeleteRequest, requested);}
  const receipt = (await requested.json()) as { requestId: string; scheduledDeletionDate: string };

  const { mail, link } = await readMail(mailbox, TestAccountStage.DeleteMail, email, DELETION_LINK_FRAGMENT);
  const confirmationToken = requireToken(TestAccountStage.DeleteMail, link);
  await mailbox.expungeMessages([mail.uid]);

  const page = await context.get(link);
  if (page.status() !== HTTP_OK) {throw await failureOf(TestAccountStage.DeletePage, page);}
  const confirmed = await context.post(new URL('confirm-form', link).href, { form: { confirmationToken } });
  if (confirmed.status() !== HTTP_OK) {throw await failureOf(TestAccountStage.DeleteConfirm, confirmed);}

  await context.dispose();
  return { ...receipt, confirmStatus: confirmed.status() };
}

/** Creates a real account the way the signup form does, verified through the real email, on a new tenant. */
export async function createTestAccount(options: CreateTestAccountOptions): Promise<TestAccount> {
  const { app, baseUrl, formElapsedMs = DEFAULT_FORM_ELAPSED_MS } = options;
  const mailbox = options.mailbox ?? defaultMailbox();
  const context = await (options.newContext ?? defaultContext)(baseUrl);
  const { email, password, tenantName, username } = newRunIdentity(app);

  const registered = await context.post('/bff/register', {
    headers: { 'Idempotency-Key': randomBytes(ID_BYTES).toString('hex') },
    data: {
      firstName: 'E2E',
      lastName: 'Bot',
      username,
      email,
      password,
      tenantName,
      website: '',
      formElapsedMs,
      verifyUrlTemplate: `${baseUrl}${VERIFY_LINK_FRAGMENT}?token={token}`,
    },
  });
  if (registered.status() !== HTTP_ACCEPTED) {throw await failureOf(TestAccountStage.Register, registered);}

  const { mail, link } = await readMail(mailbox, TestAccountStage.VerifyMail, email, VERIFY_LINK_FRAGMENT);
  const token = requireToken(TestAccountStage.VerifyMail, link);
  await mailbox.expungeMessages([mail.uid]);

  const verified = await context.post('/bff/verify-and-login', { data: { token } });
  if (verified.status() !== HTTP_OK) {throw await failureOf(TestAccountStage.VerifyAndLogin, verified);}
  const tenantId = await readTenantId(context, verified);

  let disposal: Promise<DisposedTestAccount> | undefined;
  return {
    email,
    password,
    tenantName,
    tenantId,
    context,
    dispose: (): Promise<DisposedTestAccount> => {
      disposal ??= deleteAccount(context, mailbox, email);
      return disposal;
    },
  };
}
