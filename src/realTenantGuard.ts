import { dirname, join } from 'node:path';

import { expect, test } from '@playwright/test';

import type {
  BearerProbeClient,
  ContextLike,
  FetchOptions,
  HttpReply,
  LoginRefusalSink,
  RealTenantGuardOptions,
  ResponseLike,
  RouteLike,
} from './realTenantGuardTypes';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const PATCHED = Symbol.for('e2e.real-tenant-guard.patched');
const REFUSAL = 'REFUSING TEST WRITE ON A REAL TENANT';
const LOGIN_REFUSAL = 'REFUSING TEST LOGIN ON A REAL TENANT';
const BFF_LOGIN_PATH = '/bff/login';
const HTTP_OK = 200;

type ReplyGetter = (url: string) => Promise<HttpReply>;

class RealTenantLoginRefusal extends Error {
  constructor(
    readonly slug: string,
    message: string,
  ) {
    super(message);
  }
}

function pathOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function failCurrentTest(message: string): void {
  let inTest = true;
  try {
    test.info();
  } catch {
    inTest = false;
  }
  if (!inTest) {
    throw new Error(message);
  }
  expect.soft(message, message).toBe('');
}

function clientModule<T>(file: string): T {
  const nodeRequire = require;
  const root = dirname(nodeRequire.resolve('playwright-core/package.json'));
  return nodeRequire(join(root, 'lib', 'client', file)) as T;
}

/** Refuses test writes and logins on protected tenants; the first `install()` in a process wins. */
export class RealTenantGuard {
  readonly loginRefusalSink: LoginRefusalSink = { fail: failCurrentTest };

  constructor(private readonly options: RealTenantGuardOptions) {}

  loginRefusalMessage(slug: string, source: string): string {
    return (
      `[real-tenant-guard] ${LOGIN_REFUSAL}: ${source} signed in to the protected tenant '${slug}'. ` +
      this.options.loginAdvice
    );
  }

  protectedTenantOf(rawUrl: string): string | undefined {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return undefined;
    }
    const { tenantHostPattern, sharedHostPattern, sharedHostExemptLabels = [] } = this.options;
    const host = url.hostname.toLowerCase();
    const firstLabel = host.split('.')[0] ?? '';
    const tenantHost = tenantHostPattern.test(host);
    const onSharedHost = sharedHostPattern?.test(host) === true && !sharedHostExemptLabels.includes(firstLabel);
    if ((tenantHost || onSharedHost) && this.isProtected(firstLabel)) {
      return firstLabel;
    }
    if (!tenantHost) {
      return undefined;
    }
    const segments = url.pathname.toLowerCase().split('/');
    const tIndex = segments.indexOf('t');
    const pathSlug = tIndex >= 0 ? segments[tIndex + 1] : undefined;
    return this.isProtected(pathSlug) ? pathSlug : undefined;
  }

  isRealTenantWrite(method: string, rawUrl: string): boolean {
    return !READ_METHODS.has(method.toUpperCase()) && this.protectedTenantOf(rawUrl) !== undefined;
  }

  refusalMessage(method: string, rawUrl: string): string {
    return (
      `[real-tenant-guard] ${REFUSAL}: ${method.toUpperCase()} ${rawUrl} targets the protected tenant ` +
      `'${this.protectedTenantOf(rawUrl)}'. ${this.options.writeAdvice} ` +
      `Protected slugs: ${this.options.protectedSlugs.join(', ')}`
    );
  }

  realTenantOfSession(body: unknown): string | undefined {
    const slug = (body as { tenantSlug?: unknown } | null)?.tenantSlug;
    if (typeof slug !== 'string') {
      return undefined;
    }
    const normalized = slug.trim().toLowerCase();
    return this.isProtected(normalized) ? normalized : undefined;
  }

  async refuseRealTenantBearer(client: BearerProbeClient, bearer: string): Promise<string> {
    const config = { headers: { Authorization: `Bearer ${bearer}` }, validateStatus: (): boolean => true };
    const reply = await client.get(this.options.sessionProbe.apiPath, config).catch(() => undefined);
    const slug = reply?.status === HTTP_OK ? this.realTenantOfSession(reply.data) : undefined;
    if (slug !== undefined) {
      throw this.loginRefusal(slug, 'a tenant-owner bearer');
    }
    return bearer;
  }

  install(): void {
    const state = globalThis as { [PATCHED]?: boolean };
    if (state[PATCHED]) {
      return;
    }
    this.patchBrowser();
    this.patchApiRequest();
    state[PATCHED] = true;
  }

  private isProtected(slug: string | undefined): slug is string {
    return slug !== undefined && this.options.protectedSlugs.includes(slug);
  }

  private loginRefusal(slug: string, source: string): RealTenantLoginRefusal {
    return new RealTenantLoginRefusal(slug, this.loginRefusalMessage(slug, source));
  }

  private async tenantOfReply(reply: HttpReply): Promise<string | undefined> {
    if (!reply.ok()) {
      return undefined;
    }
    return this.realTenantOfSession(await reply.json().catch(() => undefined));
  }

  private async realTenantBehindReply(method: string, reply: HttpReply, get: ReplyGetter): Promise<string | undefined> {
    const verb = method.toUpperCase();
    const url = reply.url();
    const path = pathOf(url);
    const { bffPath, pathSuffix } = this.options.sessionProbe;
    if (verb === 'GET' && path.endsWith(pathSuffix)) {
      return this.tenantOfReply(reply);
    }
    if (verb !== 'POST' || path !== BFF_LOGIN_PATH || !reply.ok()) {
      return undefined;
    }
    try {
      return await this.tenantOfReply(await get(new URL(bffPath, url).href));
    } catch (error) {
      if (error instanceof RealTenantLoginRefusal) {
        return error.slug;
      }
      return undefined;
    }
  }

  private async guardSessionResponse(context: ContextLike, response: ResponseLike): Promise<void> {
    const get: ReplyGetter = (url) => context.request.get(url);
    const slug = await this.realTenantBehindReply(response.request().method(), response, get);
    if (slug === undefined) {
      return;
    }
    await context.clearCookies().catch(() => undefined);
    this.loginRefusalSink.fail(this.loginRefusalMessage(slug, response.url()));
  }

  private async guardRoute(route: RouteLike): Promise<void> {
    const request = route.request();
    if (!this.isRealTenantWrite(request.method(), request.url())) {
      await route.fallback();
      return;
    }
    const message = this.refusalMessage(request.method(), request.url());
    await route.abort('blockedbyclient');
    failCurrentTest(message);
  }

  private patchBrowser(): void {
    const { Browser } = clientModule<{
      Browser: { prototype: { _innerNewContext: (...args: unknown[]) => Promise<ContextLike> } };
    }>('browser.js');
    const original = Browser.prototype._innerNewContext;
    const guardContext = async (context: ContextLike): Promise<void> => {
      await context.route(
        (url) => this.protectedTenantOf(url.href) !== undefined,
        (route) => this.guardRoute(route),
      );
      context.on('response', (response) => void this.guardSessionResponse(context, response));
    };
    Browser.prototype._innerNewContext = async function patched(this: unknown, ...args: unknown[]): Promise<ContextLike> {
      const context = await original.apply(this, args);
      await guardContext(context);
      return context;
    };
  }

  private patchApiRequest(): void {
    interface ApiContext {
      get(url: string): Promise<HttpReply>;
    }
    const { APIRequestContext } = clientModule<{
      APIRequestContext: { prototype: { _innerFetch: (this: ApiContext, options?: FetchOptions) => Promise<HttpReply> } };
    }>('fetch.js');
    const original = APIRequestContext.prototype._innerFetch;
    const refuseWrite = (method: string, url: string): void => {
      if (this.isRealTenantWrite(method, url)) {
        throw new Error(this.refusalMessage(method, url));
      }
    };
    const refuseSession = async (method: string, reply: HttpReply, get: ReplyGetter): Promise<void> => {
      const slug = await this.realTenantBehindReply(method, reply, get);
      if (slug !== undefined) {
        throw this.loginRefusal(slug, reply.url());
      }
    };
    APIRequestContext.prototype._innerFetch = async function patched(this: ApiContext, options: FetchOptions = {}): Promise<HttpReply> {
      const url = options.url ?? options.request?.url() ?? '';
      const method = options.method ?? options.request?.method() ?? 'GET';
      refuseWrite(method, url);
      const reply = await original.call(this, options);
      if (!options.request) {
        await refuseSession(method, reply, (probeUrl) => this.get(probeUrl));
      }
      return reply;
    };
  }
}
