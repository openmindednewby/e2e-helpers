import type { APIRequestContext, APIResponse } from '@playwright/test';

import type { CapturedEmail } from './mailMessage';

export const TestAccountStage = {
  Register: 'register',
  VerifyMail: 'verify-mail',
  VerifyAndLogin: 'verify-and-login',
  DeleteRequest: 'delete-request',
  DeleteMail: 'delete-mail',
  DeletePage: 'delete-page',
  DeleteConfirm: 'delete-confirm',
} as const;
export type TestAccountStage = (typeof TestAccountStage)[keyof typeof TestAccountStage];

/** A failed step: which stage, the HTTP status when there was one, and the machine code from the body. */
export class TestAccountError extends Error {
  constructor(
    readonly stage: TestAccountStage,
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(`createTestAccount[${stage}]: ${message}`);
    this.name = 'TestAccountError';
  }
}

export interface TestAccountMailbox {
  waitForMessageTo(to: string, options?: { matches?: (email: CapturedEmail) => boolean }): Promise<CapturedEmail>;
  expungeMessages(uids: number[]): Promise<void>;
}

export type TestAccountContext = Pick<APIRequestContext, 'get' | 'post' | 'dispose'>;

export interface CreateTestAccountOptions {
  /** Names the tenant, e.g. `jinx`. */
  app: string;
  /** The public origin whose BFF serves `/bff/*`. */
  baseUrl: string;
  /** Defaults to the `e2e-bot` mailbox. */
  mailbox?: TestAccountMailbox;
  /** Defaults to a new Playwright request context carrying `Origin` and `X-BFF-Csrf`. */
  newContext?: (baseUrl: string) => Promise<TestAccountContext>;
  /** Reported form-fill time; defaults to a human-plausible value. */
  formElapsedMs?: number;
}

export interface DisposedTestAccount {
  requestId: string;
  scheduledDeletionDate: string;
  confirmStatus: number;
}

export interface TestAccount {
  email: string;
  password: string;
  tenantName: string;
  tenantId: string;
  /** The signed-in context: session cookie plus `Origin` and `X-BFF-Csrf`. */
  context: TestAccountContext;
  /** Requests deletion, confirms through the emailed link, closes the context. Runs once. */
  dispose(): Promise<DisposedTestAccount>;
}

export type { APIResponse };
