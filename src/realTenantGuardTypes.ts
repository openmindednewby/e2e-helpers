export interface SessionProbePaths {
  bffPath: string;
  apiPath: string;
  pathSuffix: string;
}

export interface RealTenantGuardOptions {
  protectedSlugs: readonly string[];
  /** Hosts whose first label or `/t/<slug>` path names a tenant. */
  tenantHostPattern: RegExp;
  /** Wider hosts where only the first label names a tenant. */
  sharedHostPattern?: RegExp;
  /** First labels on the shared host that are not tenants. */
  sharedHostExemptLabels?: readonly string[];
  /** Endpoint whose JSON `tenantSlug` names the signed-in tenant. */
  sessionProbe: SessionProbePaths;
  /** Sentence in the refused-write message saying what to do instead. */
  writeAdvice: string;
  /** Sentence in the refused-login message saying what to do instead. */
  loginAdvice: string;
}

export interface RouteLike {
  request(): { method(): string; url(): string };
  abort(code?: string): Promise<void>;
  fallback(): Promise<void>;
}

export interface HttpReply {
  ok(): boolean;
  url(): string;
  json(): Promise<unknown>;
}

export interface ResponseLike extends HttpReply {
  request(): { method(): string };
}

export interface ContextLike {
  route(matcher: (url: URL) => boolean, handler: (route: RouteLike) => Promise<void>): Promise<void>;
  on(event: 'response', listener: (response: ResponseLike) => void): unknown;
  request: { get(url: string): Promise<HttpReply> };
  clearCookies(): Promise<void>;
}

export interface BearerProbeClient {
  get(
    url: string,
    config: { headers: Record<string, string>; validateStatus: () => boolean },
  ): Promise<{ status: number; data: unknown }>;
}

export interface FetchOptions {
  url?: string;
  method?: string;
  request?: { url(): string; method(): string };
}

export interface LoginRefusalSink {
  fail: (message: string) => void;
}
