import {
  bearer,
  csvMultipart,
  deriveUsername,
  jsonAuth,
  resolveBaseUrl,
  resolveKeycloakBaseUrl,
  uniqueEmail,
} from '../src/index';

describe('resolveBaseUrl', () => {
  const KEY = 'E2E_HELPERS_TEST_URL';
  afterEach(() => delete process.env[KEY]);

  it('returns the env value with trailing slashes trimmed', () => {
    process.env[KEY] = 'https://staging.example.com///';
    expect(resolveBaseUrl(KEY, 'http://fallback')).toBe('https://staging.example.com');
  });

  it('falls back (trimmed) when the env var is empty/unset', () => {
    expect(resolveBaseUrl(KEY, 'http://fallback/')).toBe('http://fallback');
    process.env[KEY] = '   ';
    expect(resolveBaseUrl(KEY, 'http://fallback')).toBe('http://fallback');
  });
});

describe('auth header helpers', () => {
  it('bearer sets only Authorization', () => {
    expect(bearer('t0k')).toEqual({ Authorization: 'Bearer t0k' });
  });
  it('jsonAuth sets content-type + Authorization', () => {
    expect(jsonAuth('t0k')).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer t0k' });
  });
});

describe('deriveUsername', () => {
  it('replaces every @-and-illegal run with a single dash and lowercases', () => {
    expect(deriveUsername('Jane.Doe+e2e@Example.COM')).toBe('jane.doe-e2e-example.com');
  });
  it('keeps letters, digits, underscore, dot and dash', () => {
    expect(deriveUsername('a_b-c.d1')).toBe('a_b-c.d1');
  });
});

describe('uniqueEmail', () => {
  it('is unique per call and uses the given prefix + example.com', () => {
    const a = uniqueEmail('aml-e2e');
    const b = uniqueEmail('aml-e2e');
    expect(a).not.toBe(b);
    expect(a.startsWith('aml-e2e-')).toBe(true);
    expect(a.endsWith('@example.com')).toBe(true);
  });
});

describe('csvMultipart', () => {
  it('builds a file field with the csv buffer + default name', () => {
    const m = csvMultipart('a,b\n1,2');
    expect(m.file.name).toBe('batch.csv');
    expect(m.file.mimeType).toBe('text/csv');
    expect(m.file.buffer.toString('utf-8')).toBe('a,b\n1,2');
  });
});

describe('resolveKeycloakBaseUrl', () => {
  afterEach(() => {
    delete process.env.KEYCLOAK_URL;
    delete process.env.KEYCLOAK_ISSUER;
  });
  it('prefers KEYCLOAK_URL (trimmed)', () => {
    process.env.KEYCLOAK_URL = 'https://kc.example.com/';
    expect(resolveKeycloakBaseUrl()).toBe('https://kc.example.com');
  });
  it('derives the base from KEYCLOAK_ISSUER by stripping /realms/<realm>', () => {
    process.env.KEYCLOAK_ISSUER = 'https://kc.example.com/realms/ichnos';
    expect(resolveKeycloakBaseUrl()).toBe('https://kc.example.com');
  });
  it('returns null when neither is set', () => {
    expect(resolveKeycloakBaseUrl()).toBeNull();
  });
});
