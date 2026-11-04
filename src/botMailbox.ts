import { setTimeout as delay } from 'node:timers/promises';

import { ImapFlow, type FetchMessageObject } from 'imapflow';

import { decodeMailSource, type CapturedEmail } from './mailMessage';

const DEFAULT_POLL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 60_000;
const IMAPS_PORT = 993;
const DECIMAL = 10;
const INBOX = 'INBOX';
const BOT_MAILBOX_ENV_PREFIX = 'E2E_BOT_MAILBOX';
const BOT_MAILBOX_HOST = 'mail.dloizides.com';
const BOT_MAILBOX_USER = 'e2e-bot@dloizides.com';

export interface MailboxConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  secure?: boolean;
}

export interface BotMailboxOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface WaitForMessageOptions {
  subjectIncludes?: string;
  preferNewest?: boolean;
  matches?: (email: CapturedEmail) => boolean;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (value === undefined) {
    throw new Error(`loadMailboxConfig: required env var ${name} is unset. Add it to .env.<target>.secrets.`);
  }
  return value;
}

/** Reads `<PREFIX>_HOST`, `_PORT`, `_USER` and `_PASSWORD`; `defaults` fill the first three. */
export function loadMailboxConfig(
  envPrefix: string,
  defaults: { host?: string; port?: number; user?: string } = {},
): MailboxConfig {
  const portText = readEnv(`${envPrefix}_PORT`);
  const port = portText === undefined ? (defaults.port ?? IMAPS_PORT) : Number.parseInt(portText, DECIMAL);
  return {
    host: readEnv(`${envPrefix}_HOST`) ?? defaults.host ?? requireEnv(`${envPrefix}_HOST`),
    port,
    user: readEnv(`${envPrefix}_USER`) ?? defaults.user ?? requireEnv(`${envPrefix}_USER`),
    password: requireEnv(`${envPrefix}_PASSWORD`),
    secure: port === IMAPS_PORT,
  };
}

/** The `e2e-bot` mailbox; only `E2E_BOT_MAILBOX_PASSWORD` is required. */
export function loadBotMailboxConfig(): MailboxConfig {
  return loadMailboxConfig(BOT_MAILBOX_ENV_PREFIX, { host: BOT_MAILBOX_HOST, port: IMAPS_PORT, user: BOT_MAILBOX_USER });
}

function toCapturedEmail(msg: FetchMessageObject): CapturedEmail | null {
  if (!msg.envelope || !msg.source) {return null;}
  const to = (msg.envelope.to ?? [])
    .map(addr => (addr.name ? `${addr.name} <${addr.address ?? ''}>` : addr.address ?? ''))
    .join(', ');
  return { uid: msg.uid, subject: msg.envelope.subject ?? '', to, ...decodeMailSource(msg.source.toString('utf8')) };
}

function matchesWanted(email: CapturedEmail, to: string, options: WaitForMessageOptions): boolean {
  if (!email.to.includes(to)) {return false;}
  if (options.subjectIncludes !== undefined && !email.subject.includes(options.subjectIncludes)) {return false;}
  return options.matches === undefined || options.matches(email);
}

/** Polls a shared inbox over IMAP; plus-addressed runs filter by their own address. */
export class BotMailbox {
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: MailboxConfig,
    options: BotMailboxOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Waits for the first unseen message whose To header contains `to`; throws on timeout. */
  async waitForMessageTo(to: string, options: WaitForMessageOptions = {}): Promise<CapturedEmail> {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const found = await this.withInbox(client => this.findMessage(client, to, options));
      if (found) {return found;}
      await delay(this.pollIntervalMs);
    }
    throw new Error(`BotMailbox: timed out after ${String(this.timeoutMs)}ms waiting for a message to ${to}`);
  }

  /** Deletes the given UIDs from the inbox. */
  async expungeMessages(uids: number[]): Promise<void> {
    if (uids.length === 0) {return;}
    await this.withInbox(async client => {
      await client.messageDelete(uids.join(','), { uid: true });
    });
  }

  private async withInbox<T>(work: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure ?? this.config.port === IMAPS_PORT,
      auth: { user: this.config.user, pass: this.config.password },
      logger: false,
    });
    await client.connect();
    const lock = await client.getMailboxLock(INBOX);
    try {
      return await work(client);
    } finally {
      lock.release();
      await client.logout().catch(() => undefined);
    }
  }

  private async findMessage(client: ImapFlow, to: string, options: WaitForMessageOptions): Promise<CapturedEmail | null> {
    if (client.mailbox === false || client.mailbox.exists === 0) {return null;}
    let newest: CapturedEmail | null = null;
    for await (const msg of client.fetch('1:*', { source: true, envelope: true, flags: true })) {
      if (msg.flags?.has('\\Seen')) {continue;}
      const email = toCapturedEmail(msg);
      if (email === null || !matchesWanted(email, to, options)) {continue;}
      if (options.preferNewest !== true) {return email;}
      if (newest === null || email.uid > newest.uid) {newest = email;}
    }
    return newest;
  }
}
