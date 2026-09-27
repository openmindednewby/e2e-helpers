/**
 * @dloizides/e2e-helpers — the shared vehicle for the estate's two-tier (`@api` / `@ui`) Playwright
 * E2E suites. Generic, product-agnostic building blocks extracted from the copy-pasted per-product
 * helpers (ichnos-helpers, aml-helpers, agora, …): reachability, ROPC realm tokens, auth headers,
 * health polling, multipart CSV, and username/email derivation.
 *
 * Playwright is a PEER dependency — the consuming E2E suite provides it; this package only imports its
 * types. Every network helper returns `null`/false on failure so specs `test.skip` gracefully in
 * environments where the target isn't reachable, rather than false-failing.
 */
import { randomInt } from 'node:crypto';
import type { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * Strip trailing slashes without a regex — `/\/+$/` is the classic unanchored-quantifier-before-`$`
 * shape that backtracks super-linearly on a pathological run of slashes (sonarjs/super-linear-regex).
 */
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') {
    end -= 1;
  }
  return value.slice(0, end);
}

/** Resolve a base URL from an env var (trailing slashes trimmed), falling back to a default. */
export function resolveBaseUrl(envVar: string, fallback: string): string {
  const value = process.env[envVar];
  const chosen = value && value.trim() ? value.trim() : fallback;
  return stripTrailingSlashes(chosen);
}

export interface TryRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  data?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Attempt a request against `${baseUrl}${path}`. Returns `{ response, url }`, or `null` when the host
 * is unreachable (network error) — so a spec can `test.skip` gracefully where the service isn't up.
 * A non-2xx is still a real response (returned, not null); only a transport failure yields null.
 */
export async function tryRequest(
  request: APIRequestContext,
  baseUrl: string,
  path: string,
  options: TryRequestOptions = {},
): Promise<{ response: APIResponse; url: string } | null> {
  const url = `${baseUrl}${path}`;
  try {
    const response = await request.fetch(url, {
      method: options.method ?? 'GET',
      data: options.data as never,
      headers: options.headers,
      timeout: options.timeoutMs ?? 10_000,
    });
    return { response, url };
  } catch {
    return null;
  }
}

/** `Authorization: Bearer <token>` (GET/DELETE). */
export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** JSON content-type + bearer (POST/PUT/PATCH bodies). */
export function jsonAuth(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/** Derive the Keycloak base URL (no `/realms/...`) from `KEYCLOAK_URL` or `KEYCLOAK_ISSUER`. */
export function resolveKeycloakBaseUrl(): string | null {
  const explicit = process.env.KEYCLOAK_URL?.trim();
  if (explicit) {return stripTrailingSlashes(explicit);}
  const issuer = process.env.KEYCLOAK_ISSUER?.trim();
  if (!issuer) {return null;}
  const match = /^(.*?)\/realms\/[^/]+/.exec(issuer);
  return match?.[1] ? stripTrailingSlashes(match[1]) : null;
}

export interface RealmTokenOptions {
  username: string;
  password: string;
  clientId: string;
  clientSecret?: string;
  /** Keycloak base (no `/realms`). Defaults to {@link resolveKeycloakBaseUrl}. */
  keycloakBaseUrl?: string | null;
  scope?: string;
}

/**
 * Acquire a realm access token via Resource-Owner-Password-Credentials. Returns `null` (so the caller
 * `test.skip`s the authed assertions) when the base / credentials aren't configured — the
 * unauthenticated negative assertions in a spec always run regardless. MUST use a TENANT user (carries
 * the tenant claim), not a platform super-user, for tenant-scoped endpoints.
 */
export async function getRealmToken(realm: string, options: RealmTokenOptions): Promise<string | null> {
  const kcBase = options.keycloakBaseUrl ?? resolveKeycloakBaseUrl();
  const username = options.username?.trim();
  const password = options.password?.trim();
  if (!kcBase || !username || !password || !options.clientId) {return null;}

  const fields: Record<string, string> = {
    grant_type: 'password',
    client_id: options.clientId,
    username,
    password,
    scope: options.scope ?? 'openid',
  };
  if (options.clientSecret) {fields.client_secret = options.clientSecret;}

  try {
    const res = await fetch(`${kcBase}/realms/${realm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
    if (!res.ok) {return null;}
    const body = (await res.json()) as { access_token?: string };
    return body.access_token ?? null;
  } catch {
    return null;
  }
}

/** Poll `${baseUrl}${path}` until it responds 2xx or the timeout elapses; returns the last response. */
export async function waitForHealthy(
  request: APIRequestContext,
  baseUrl: string,
  path: string,
  timeoutMs = 30_000,
): Promise<{ response: APIResponse; url: string }> {
  const url = `${baseUrl}${path}`;
  const deadline = Date.now() + timeoutMs;
  let last: APIResponse = await request.fetch(url, { timeout: 5_000 });
  while (!last.ok() && Date.now() <= deadline) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    last = await request.fetch(url, { timeout: 5_000 });
  }
  return { response: last, url };
}

const USERNAME_DISALLOWED = /[^a-z0-9._-]+/g;

/**
 * Derive a Keycloak-legal username from an email — TenantService's register validator only allows
 * letters, digits, underscore, dot or dash, so the raw email (with its `@`) 400s. The user still signs
 * in by email (Keycloak resolves email → user).
 */
export function deriveUsername(email: string): string {
  return email.trim().toLowerCase().replace(USERNAME_DISALLOWED, '-');
}

/** A unique email per run (timestamp + random) so each register creates a fresh tenant. */
export function uniqueEmail(prefix = 'e2e'): string {
  const stamp = `${Date.now().toString(36)}${randomInt(1_000_000).toString(36)}`;
  return `${prefix}-${stamp}@example.com`;
}

/**
 * Build a Playwright multipart body for a CSV upload. FastEndpoints binds the `IFormFile File` from a
 * form field named `file` (case-insensitive).
 */
export function csvMultipart(
  csv: string,
  filename = 'batch.csv',
): { file: { name: string; mimeType: string; buffer: Buffer } } {
  return { file: { name: filename, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') } };
}
