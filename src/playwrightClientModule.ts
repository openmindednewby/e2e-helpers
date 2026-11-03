import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const SUPPORTED_RANGE = '>=1.40.0 <1.60.0';
const MODULE_NOT_FOUND = 'MODULE_NOT_FOUND';

/** The subset of Node's `require` that loading a Playwright client file needs. */
export interface ClientModuleRequire {
  (id: string): unknown;
  resolve(id: string): string;
}

/** `RealTenantGuard.install()` cannot patch this Playwright: its `lib/client` file does not exist. */
export class UnsupportedPlaywrightVersionError extends Error {
  readonly supportedRange = SUPPORTED_RANGE;

  constructor(
    readonly version: string,
    readonly file: string,
  ) {
    super(
      `RealTenantGuard does not support playwright-core ${version}: lib/client/${file} does not exist. ` +
        `Supported range: ${SUPPORTED_RANGE}.`,
    );
    this.name = 'UnsupportedPlaywrightVersionError';
  }
}

function isMissingModule(error: unknown, modulePath: string): boolean {
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === MODULE_NOT_FOUND && typeof message === 'string' && message.includes(modulePath);
}

/** Loads `playwright-core/lib/client/<file>`, resolved from this package rather than the caller's directory. */
export function clientModule<T>(file: string, nodeRequire: ClientModuleRequire = createRequire(__filename)): T {
  const packageJsonPath = nodeRequire.resolve('playwright-core/package.json');
  const modulePath = join(dirname(packageJsonPath), 'lib', 'client', file);
  try {
    return nodeRequire(modulePath) as T;
  } catch (error) {
    if (isMissingModule(error, modulePath)) {
      const { version } = nodeRequire(packageJsonPath) as { version: string };
      throw new UnsupportedPlaywrightVersionError(version, file);
    }
    throw error;
  }
}
