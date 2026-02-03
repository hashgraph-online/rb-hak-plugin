export class RegistryBrokerParseError extends Error {
  rawValue?: unknown;

  constructor(message: string, rawValue?: unknown) {
    super(message);
    this.name = 'RegistryBrokerParseError';
    this.rawValue = rawValue;
  }
}

export class RegistryBrokerClient {
  constructor(_options: unknown) {}

  authenticateWithLedgerCredentials(_options: unknown): Promise<void> {
    return Promise.resolve();
  }

  static async initializeAgent(_options: unknown): Promise<{
    encryption: unknown;
    client: { getDefaultHeaders: () => Record<string, string> };
  }> {
    return {
      encryption: null,
      client: { getDefaultHeaders: () => ({}) },
    };
  }
}

export class Logger {
  static getInstance(_options?: unknown): {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
  } {
    return {};
  }
}

