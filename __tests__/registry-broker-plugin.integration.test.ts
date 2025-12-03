import { jest } from '@jest/globals';
import { Client, PrivateKey } from '@hashgraph/sdk';
import { AgentMode, HederaLangchainToolkit } from 'hedera-agent-kit';
import {
  createRegistryBrokerPlugin,
  registryBrokerPluginToolNames,
} from '../src/RegistryBrokerPlugin';

jest.setTimeout(180000);

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const OPENROUTER_DEMO_UAID =
  'uaid:aid:2bnewJwP95isoCUkT5mee5gm212WS76tphHwBQvbWoquRa9kt89UanrBqHXpaSh4AN;uid=anthropic/claude-3.5-sonnet;registry=openrouter;proto=openrouter;nativeId=anthropic/claude-3.5-sonnet';

const pickEnvValue = (keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
};

const requireEnvValue = (label: string, keys: string[]): string => {
  const value = pickEnvValue(keys);
  if (value) {
    return value;
  }
  throw new Error(
    `${label} is required for integration tests. Set one of: ${keys.join(', ')}`,
  );
};

const resolveLedgerNetwork = (): 'hedera:mainnet' | 'hedera:testnet' | 'hedera:previewnet' => {
  const hederaNetwork = pickEnvValue(['HEDERA_NETWORK']);
  if (hederaNetwork) {
    const normalized = hederaNetwork.replace(/^hedera:/i, '').toLowerCase();
    if (normalized === 'mainnet') {
      return 'hedera:mainnet';
    }
    if (normalized === 'previewnet') {
      return 'hedera:previewnet';
    }
    return 'hedera:testnet';
  }
  const hasMainnetCredentials = Boolean(
    pickEnvValue(['MAINNET_HEDERA_ACCOUNT_ID', 'MAINNET_HEDERA_PRIVATE_KEY']),
  );
  return hasMainnetCredentials ? 'hedera:mainnet' : 'hedera:testnet';
};

const resolveLedgerCredentials = () => {
  const network = resolveLedgerNetwork();
  const preferMainnet = network === 'hedera:mainnet';
  const accountId = preferMainnet
    ? requireEnvValue('Ledger account', [
        'MAINNET_HEDERA_ACCOUNT_ID',
        'HEDERA_OPERATOR_ID',
        'HEDERA_ACCOUNT_ID',
      ])
    : requireEnvValue('Ledger account', [
        'HEDERA_OPERATOR_ID',
        'HEDERA_ACCOUNT_ID',
        'MAINNET_HEDERA_ACCOUNT_ID',
      ]);
  const privateKey = preferMainnet
    ? requireEnvValue('Ledger private key', [
        'MAINNET_HEDERA_PRIVATE_KEY',
        'HEDERA_OPERATOR_KEY',
        'HEDERA_PRIVATE_KEY',
      ])
    : requireEnvValue('Ledger private key', [
        'HEDERA_OPERATOR_KEY',
        'HEDERA_PRIVATE_KEY',
        'MAINNET_HEDERA_PRIVATE_KEY',
      ]);
  return { accountId, privateKey, network };
};

const createHederaClient = () => {
  const { accountId, privateKey, network } = resolveLedgerCredentials();
  let client: Client;
  if (network === 'hedera:mainnet') {
    client = Client.forMainnet();
  } else if (network === 'hedera:previewnet') {
    client = Client.forPreviewnet();
  } else {
    client = Client.forTestnet();
  }
  client.setOperator(accountId, PrivateKey.fromStringECDSA(privateKey));
  return { client, network };
};

const resolveDemoUaids = (): string[] => {
  const seen = new Set<string>();
  const candidates = [
    process.env.REGISTRY_BROKER_DEMO_PAID_UAID,
    process.env.REGISTRY_BROKER_DEMO_A2A_UAID,
    OPENROUTER_DEMO_UAID,
  ];
  const result: string[] = [];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type ToolResponse = {
  success?: boolean;
  error?: string;
  result?: Record<string, unknown>;
};

const createChatSession = async (
  registryTool: { invoke: (input: unknown) => Promise<string> },
  uaids: string[],
): Promise<{ session: any; uaid: string }> => {
  let lastError: unknown;
  for (const candidate of uaids) {
    try {
      const raw = await registryTool.invoke({
        operation: 'chat.createSession',
        payload: { uaid: candidate, historyTtlSeconds: 180 },
      });
      const parsed = JSON.parse(raw) as ToolResponse;
      if (parsed?.success) {
        return { session: parsed, uaid: candidate };
      }
      const responseError =
        parsed?.error ?? 'chat.createSession returned an unsuccessful response';
      lastError = new Error(responseError);
      logger.warn?.(
        `chat.createSession unsuccessful for ${candidate}: ${responseError}`,
      );
    } catch (error) {
      lastError = error;
      logger.warn?.(
        `chat.createSession failed for ${candidate}: ${describeError(error)}`,
      );
    }
  }
  throw lastError ?? new Error('Unable to create chat session with any UAID candidate.');
};

describe('RegistryBrokerPlugin (integration)', () => {
  it('performs a live search, chat session, and message send through the registry broker', async () => {
    const originalFetchMode = process.env.JEST_REAL_FETCH;
    process.env.JEST_REAL_FETCH = 'true';
    const { client } = createHederaClient();
    const plugin = createRegistryBrokerPlugin({
      configuration: {
        client: {
          disableEnvApiKey: true,
          disableEnvLedgerApiKey: true,
        },
      },
      logger,
    });

    const toolkit = new HederaLangchainToolkit({
      client,
      configuration: {
        plugins: [plugin],
        tools: [registryBrokerPluginToolNames.REGISTRY_BROKER_OPERATION_TOOL],
        context: { mode: AgentMode.AUTONOMOUS },
      },
    });
    const registryTool = toolkit
      .getTools()
      .find(tool => tool.name === registryBrokerPluginToolNames.REGISTRY_BROKER_OPERATION_TOOL);
    expect(registryTool).toBeDefined();

    try {
      const searchRaw = await registryTool!.invoke({
        operation: 'search',
        payload: { limit: 1 },
      });
      const searchParsed = JSON.parse(searchRaw);
      expect(searchParsed.success).toBe(true);
      const hits =
        searchParsed.result?.parsed === false
          ? searchParsed.result.raw?.hits ?? []
          : searchParsed.result?.hits ?? [];
      expect(Array.isArray(hits)).toBe(true);

      const { session, uaid } = await createChatSession(
        registryTool!,
        resolveDemoUaids(),
      );
      expect(session.success).toBe(true);
      expect(typeof session.result.sessionId).toBe('string');
      logger.info?.(`chat.createSession succeeded for ${uaid}`);
      const sessionId: string = session.result.sessionId;

      const messageRaw = await registryTool!.invoke({
        operation: 'chat.sendMessage',
        payload: {
          sessionId,
          message: 'Hello from the registry-broker-plugin integration test.',
        },
      });
      const message = JSON.parse(messageRaw);
      expect(message.success).toBe(true);

      const historyRaw = await registryTool!.invoke({
        operation: 'chat.getHistory',
        payload: { sessionId },
      });
      const history = JSON.parse(historyRaw);
      expect(history.success).toBe(true);

      const endRaw = await registryTool!.invoke({
        operation: 'chat.endSession',
        payload: { sessionId },
      });
      const endParsed = JSON.parse(endRaw);
      expect(endParsed.success).toBe(true);
    } finally {
      client.close();
      if (originalFetchMode) {
        process.env.JEST_REAL_FETCH = originalFetchMode;
      } else {
        delete process.env.JEST_REAL_FETCH;
      }
    }
  });
});
