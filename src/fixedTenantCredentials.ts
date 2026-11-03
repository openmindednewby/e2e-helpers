export interface BffCredentials {
  username: string;
  password: string;
}

function readEnv(envPrefixes: readonly string[], suffix: string): string {
  for (const prefix of envPrefixes) {
    const value = process.env[`${prefix}_${suffix}`];
    if (value !== undefined) {
      return value;
    }
  }
  return '';
}

/** Reads `<PREFIX>_USERNAME` and `<PREFIX>_PASSWORD`, each from the first prefix that sets it, else empty. */
export function fixedTenantCredentials(...envPrefixes: readonly string[]): BffCredentials {
  return {
    username: readEnv(envPrefixes, 'USERNAME'),
    password: readEnv(envPrefixes, 'PASSWORD'),
  };
}
