import { Buffer } from 'node:buffer';
import {
  RegistryBrokerClient,
  type LedgerCredentialAuthOptions,
  type RegistryBrokerClientOptions,
} from '@hashgraphonline/standards-sdk';
import type { RegistryBrokerPluginLogger } from './types';

export interface RegistryBrokerLedgerOptions
  extends LedgerCredentialAuthOptions {
  autoAuthenticate?: boolean;
}

export interface RegistryBrokerPluginClientOptions
  extends RegistryBrokerClientOptions {
  disableEnvApiKey?: boolean;
  disableEnvLedgerApiKey?: boolean;
}

export interface RegistryBrokerPluginConfiguration {
  client?: RegistryBrokerPluginClientOptions;
  ledger?: RegistryBrokerLedgerOptions;
}

export interface HederaOperatorClient {
  ledgerId?: HederaLedgerIdLike | null;
  getOperator?: () => HederaOperatorLike | null;
}

type HederaLedgerIdLike = {
  isMainnet?: () => boolean;
  isPreviewnet?: () => boolean;
  isTestnet?: () => boolean;
  toString?: () => string;
};

type HederaOperatorLike = {
  accountId?: { toString?: () => string } | string;
  publicKey?: { toString?: () => string } | string;
  transactionSigner?: (message: Uint8Array) => Promise<Uint8Array>;
};

export interface RegistryBrokerClientResolutionContext {
  hederaClient?: HederaOperatorClient;
}

type ClientFactory = (
  options: RegistryBrokerClientOptions,
) => RegistryBrokerClient;

const env = (key: string): string | undefined =>
  process.env[key]?.trim() || undefined;

export class RegistryBrokerClientProvider {
  private clientPromise: Promise<RegistryBrokerClient> | null = null;

  constructor(
    private readonly config: RegistryBrokerPluginConfiguration | undefined,
    private readonly logger: RegistryBrokerPluginLogger,
    private readonly createClient: ClientFactory = options =>
      new RegistryBrokerClient(options),
  ) {}

  async getClient(
    context?: RegistryBrokerClientResolutionContext,
  ): Promise<RegistryBrokerClient> {
    if (!this.clientPromise) {
      this.clientPromise = this.initialiseClient(context);
    }
    return this.clientPromise;
  }

  private async initialiseClient(
    context?: RegistryBrokerClientResolutionContext,
  ): Promise<RegistryBrokerClient> {
    const options = this.buildClientOptions();
    const client = this.createClient(options);
    const ledgerConfig = this.resolveLedgerOptions(context);
    if (ledgerConfig) {
      const { autoAuthenticate, ...authOptions } = ledgerConfig;
      if (autoAuthenticate === false) {
        this.logger.info?.(
          '[RegistryBrokerPlugin] Ledger authentication disabled via configuration.',
        );
      } else {
        await client.authenticateWithLedgerCredentials(authOptions);
        this.logger.info?.(
          `[RegistryBrokerPlugin] Authenticated with ledger account ${authOptions.accountId}.`,
        );
      }
    } else if (!options.apiKey) {
      this.logger.warn?.(
        '[RegistryBrokerPlugin] Neither REGISTRY_BROKER_API_KEY nor ledger credentials were provided. Paid endpoints will fail.',
      );
    }
    return client;
  }

  private buildClientOptions(): RegistryBrokerClientOptions {
    const { disableEnvApiKey, disableEnvLedgerApiKey, ...clientOverrides } =
      this.config?.client ?? {};

    const merged: RegistryBrokerClientOptions = {
      ...clientOverrides,
    };

    merged.baseUrl =
      merged.baseUrl ?? env('REGISTRY_BROKER_BASE_URL') ?? merged.baseUrl;

    let apiKey = this.normalizeSecret(clientOverrides.apiKey);
    if (apiKey === undefined && disableEnvApiKey !== true) {
      apiKey = this.normalizeSecret(env('REGISTRY_BROKER_API_KEY')) ?? undefined;
    }
    merged.apiKey = apiKey;

    let ledgerApiKey = this.normalizeSecret(clientOverrides.ledgerApiKey);
    if (ledgerApiKey === undefined && disableEnvLedgerApiKey !== true) {
      ledgerApiKey = this.normalizeSecret(env('REGISTRY_BROKER_LEDGER_KEY')) ?? undefined;
    }
    merged.ledgerApiKey = ledgerApiKey;

    return merged;
  }

  private normalizeSecret(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private resolveLedgerOptions(
    context?: RegistryBrokerClientResolutionContext,
  ): RegistryBrokerLedgerOptions | undefined {
    if (this.config?.ledger) {
      return this.normalizeLedgerConfig(this.config.ledger);
    }
    const hederaDerived = this.deriveLedgerOptionsFromHederaClient(context);
    if (hederaDerived) {
      return hederaDerived;
    }
    return this.deriveLedgerOptionsFromEnv();
  }

  private normalizeLedgerConfig(
    ledger: RegistryBrokerLedgerOptions,
  ): RegistryBrokerLedgerOptions {
    if (!ledger.network) {
      return ledger;
    }
    return {
      ...ledger,
      network: this.normaliseHederaNetwork(ledger.network),
    };
  }

  private deriveLedgerOptionsFromEnv():
    | RegistryBrokerLedgerOptions
    | undefined {
    const operatorCredentials = this.pickLedgerEnvSet({
      accountKey: 'HEDERA_OPERATOR_ID',
      privateKey: 'HEDERA_OPERATOR_KEY',
      fallbackAccountKey: 'HEDERA_ACCOUNT_ID',
      fallbackPrivateKey: 'HEDERA_PRIVATE_KEY',
      preferMainnet: false,
    });
    const mainnetCredentials = this.pickLedgerEnvSet({
      accountKey: 'MAINNET_HEDERA_ACCOUNT_ID',
      privateKey: 'MAINNET_HEDERA_PRIVATE_KEY',
      preferMainnet: true,
    });

    const selected = operatorCredentials ?? mainnetCredentials;
    if (!selected) {
      return undefined;
    }

    const network = this.normaliseHederaNetwork(
      env('HEDERA_NETWORK'),
      selected.preferMainnet,
    );

    return {
      accountId: selected.accountId,
      hederaPrivateKey: selected.privateKey,
      network,
    };
  }

  private normaliseHederaNetwork(
    value?: string,
    preferMainnet = false,
  ): string {
    const raw = value?.trim();
    if (!raw) {
      return preferMainnet ? 'hedera:mainnet' : 'hedera:testnet';
    }
    const lower = raw.toLowerCase();
    if (lower.startsWith('hedera:')) {
      return lower;
    }
    return `hedera:${lower}`;
  }

  private deriveLedgerOptionsFromHederaClient(
    context?: RegistryBrokerClientResolutionContext,
  ): RegistryBrokerLedgerOptions | undefined {
    const hederaClient = context?.hederaClient;
    if (!hederaClient || typeof hederaClient.getOperator !== 'function') {
      return undefined;
    }
    const operator = hederaClient.getOperator();
    if (!operator) {
      this.logger.warn?.(
        '[RegistryBrokerPlugin] Hedera client does not expose an operator. Falling back to environment variables.',
      );
      return undefined;
    }
    const transactionSigner = operator.transactionSigner;
    if (!operator?.accountId || typeof transactionSigner !== 'function') {
      this.logger.warn?.(
        '[RegistryBrokerPlugin] Hedera client operator credentials are unavailable. Falling back to environment variables.',
      );
      return undefined;
    }
    const accountId = this.formatAccountId(operator.accountId);
    if (!accountId) {
      this.logger.warn?.(
        '[RegistryBrokerPlugin] Hedera operator account ID is invalid. Falling back to environment variables.',
      );
      return undefined;
    }
    const publicKey = this.formatAccountId(operator.publicKey);
    const network = this.deriveNetworkFromHederaClient(hederaClient);
    return {
      accountId,
      network,
      autoAuthenticate: true,
      label: 'Hedera Agent Kit operator',
      sign: async (message: string) => {
        const payload = Buffer.from(message, 'utf8');
        const signatureBytes = await transactionSigner(payload);
        return {
          signature: Buffer.from(signatureBytes).toString('base64'),
          signatureKind: 'raw',
          publicKey,
        };
      },
    };
  }

  private deriveNetworkFromHederaClient(client: HederaOperatorClient): string {
    const ledgerId = client.ledgerId ?? null;
    if (ledgerId) {
      if (this.invokeLedgerCheck(ledgerId, 'isMainnet')) {
        return 'hedera:mainnet';
      }
      if (this.invokeLedgerCheck(ledgerId, 'isPreviewnet')) {
        return 'hedera:previewnet';
      }
      if (this.invokeLedgerCheck(ledgerId, 'isTestnet')) {
        return 'hedera:testnet';
      }
      const label = ledgerId.toString?.();
      if (typeof label === 'string' && label.length > 0) {
        return this.normaliseHederaNetwork(label);
      }
    }
    return this.normaliseHederaNetwork(env('HEDERA_NETWORK'));
  }

  private invokeLedgerCheck(
    ledgerId: HederaLedgerIdLike,
    method: keyof Pick<
      HederaLedgerIdLike,
      'isMainnet' | 'isPreviewnet' | 'isTestnet'
    >,
  ): boolean {
    const fn = ledgerId[method];
    if (typeof fn === 'function') {
      try {
        return Boolean(fn.call(ledgerId));
      } catch {
        return false;
      }
    }
    return false;
  }

  private formatAccountId(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    if (typeof value === 'object' && value && 'toString' in value) {
      const formatted = value.toString?.();
      if (typeof formatted === 'string') {
        const trimmed = formatted.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      }
    }
    return undefined;
  }

  private pickLedgerEnvSet(params: {
    accountKey: string;
    privateKey: string;
    fallbackAccountKey?: string;
    fallbackPrivateKey?: string;
    preferMainnet: boolean;
  }): { accountId: string; privateKey: string; preferMainnet: boolean } | null {
    const accountId =
      env(params.accountKey) ??
      (params.fallbackAccountKey ? env(params.fallbackAccountKey) : undefined);
    const privateKey =
      env(params.privateKey) ??
      (params.fallbackPrivateKey ? env(params.fallbackPrivateKey) : undefined);
    if (!accountId || !privateKey) {
      return null;
    }
    return { accountId, privateKey, preferMainnet: params.preferMainnet };
  }
}
