import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client, PrivateKey } from '@hashgraph/sdk';
import { AgentMode, HederaLangchainToolkit } from 'hedera-agent-kit';
import { Logger } from '@hashgraphonline/standards-sdk';
import {
  createRegistryBrokerPlugin,
  registryBrokerPluginToolNames,
} from '../src/RegistryBrokerPlugin';

const loadEnvIfExists = (relativePath: string): void => {
  const resolved = path.resolve(process.cwd(), relativePath);
  loadEnv({ path: resolved, override: false });
};

loadEnvIfExists('.env');

const logger = Logger.getInstance({ module: 'RegistryBrokerPluginDemo' });

const pickEnvValue = (keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
};

const requireEnvFromKeys = (label: string, keys: string[]): string => {
  const value = pickEnvValue(keys);
  if (!value) {
    throw new Error(`${label} is required. Provide one of: ${keys.join(', ')}`);
  }
  return value;
};

const normaliseNetwork = (
  value: string | undefined
): 'hedera:mainnet' | 'hedera:testnet' | 'hedera:previewnet' => {
  const raw = value?.replace(/^hedera:/i, '').toLowerCase();
  if (raw === 'mainnet') {
    return 'hedera:mainnet';
  }
  if (raw === 'previewnet') {
    return 'hedera:previewnet';
  }
  return 'hedera:testnet';
};

const createHederaClient = () => {
  const network = normaliseNetwork(
    process.env.HEDERA_NETWORK ??
      (process.env.MAINNET_HEDERA_ACCOUNT_ID ||
      process.env.MAINNET_HEDERA_PRIVATE_KEY
        ? 'hedera:mainnet'
        : undefined)
  );
  const preferMainnet = network === 'hedera:mainnet';
  const accountId = preferMainnet
    ? requireEnvFromKeys('Hedera account ID', [
        'MAINNET_HEDERA_ACCOUNT_ID',
        'HEDERA_OPERATOR_ID',
        'HEDERA_ACCOUNT_ID',
      ])
    : requireEnvFromKeys('Hedera account ID', [
        'HEDERA_OPERATOR_ID',
        'HEDERA_ACCOUNT_ID',
        'MAINNET_HEDERA_ACCOUNT_ID',
      ]);
  const privateKey = preferMainnet
    ? requireEnvFromKeys('Hedera private key', [
        'MAINNET_HEDERA_PRIVATE_KEY',
        'HEDERA_OPERATOR_KEY',
        'HEDERA_PRIVATE_KEY',
      ])
    : requireEnvFromKeys('Hedera private key', [
        'HEDERA_OPERATOR_KEY',
        'HEDERA_PRIVATE_KEY',
        'MAINNET_HEDERA_PRIVATE_KEY',
      ]);
  let client: Client;
  if (network === 'hedera:mainnet') {
    client = Client.forMainnet();
  } else if (network === 'hedera:previewnet') {
    client = Client.forPreviewnet();
  } else {
    client = Client.forTestnet();
  }
  client.setOperator(accountId, PrivateKey.fromStringECDSA(privateKey));
  return { client, network, accountId };
};

const registryToolName =
  registryBrokerPluginToolNames.REGISTRY_BROKER_OPERATION_TOOL;
const OPENROUTER_DEMO_UAID =
  'uaid:aid:2bnewJwP95isoCUkT5mee5gm212WS76tphHwBQvbWoquRa9kt89UanrBqHXpaSh4AN;uid=anthropic/claude-3.5-sonnet;registry=openrouter;proto=openrouter;nativeId=anthropic/claude-3.5-sonnet';

const logSection = (title: string): void => {
  logger.info('');
  logger.info(`=== ${title} ===`);
};

interface ToolResponse {
  success?: boolean;
  error?: string;
  result?: Record<string, unknown>;
  [key: string]: unknown;
}

const pretty = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  const serialised = JSON.stringify(value, null, 2);
  return serialised ? serialised.replace(/"([^"]+)":/g, '"$1":') : '';
};

const parseToolResponse = (raw: string, label: string): ToolResponse => {
  const parsed = JSON.parse(raw) as ToolResponse;
  if (!parsed?.success) {
    throw new Error(`${label} failed: ${parsed?.error ?? 'unknown error'}`);
  }
  return parsed;
};

const uniqueValues = (values: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
};

const resolveDemoUaids = (): string[] =>
  uniqueValues([
    process.env.REGISTRY_BROKER_DEMO_PAID_UAID,
    process.env.REGISTRY_BROKER_DEMO_A2A_UAID,
    OPENROUTER_DEMO_UAID,
  ]);

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const requireSessionId = (response: ToolResponse): string => {
  const sessionId = response.result?.sessionId;
  if (typeof sessionId === 'string') {
    return sessionId;
  }
  throw new Error('Session ID missing from registry response.');
};

const main = async (): Promise<void> => {
  const { client, network, accountId } = createHederaClient();

  const registryPlugin = createRegistryBrokerPlugin({
    configuration: {
      client: {
        disableEnvApiKey: true,
        disableEnvLedgerApiKey: true,
      },
    },
  });

  type ToolkitInit = ConstructorParameters<typeof HederaLangchainToolkit>[0];

  const toolkit = new HederaLangchainToolkit({
    client: client as unknown as ToolkitInit['client'],
    configuration: {
      plugins: [registryPlugin],
      tools: [registryToolName],
      context: {
        mode: AgentMode.AUTONOMOUS,
        accountId,
      },
    },
  });

  logSection('Initializing Hedera Agent Kit');
  logger.info('Connected network:', network);
  logger.info('Loaded tools:', toolkit.getTools().length);

  const registryTool = toolkit
    .getTools()
    .find((tool) => tool.name === registryToolName);

  if (!registryTool) {
    throw new Error(
      'Registry Broker tool was not registered with HederaLangchainToolkit.'
    );
  }

  const registrySearchRaw = await registryTool.invoke({
    operation: 'search',
    payload: { limit: 2 },
  });
  const registrySearch = parseToolResponse(registrySearchRaw, 'Search');
  logSection('Search Results (top 2)');
  logger.info(pretty(registrySearch.result?.hits ?? []));

  const uaidCandidates = resolveDemoUaids();

  logSection('Starting Chat Session');
  let session: ToolResponse | null = null;
  let sessionUaid: string | null = null;
  let lastSessionError: unknown;
  for (const candidate of uaidCandidates) {
    try {
      const startSessionRaw = await registryTool.invoke({
        operation: 'chat.createSession',
        payload: {
          uaid: candidate,
          historyTtlSeconds: 300,
        },
      });
      session = parseToolResponse(
        startSessionRaw,
        `Create session (${candidate})`
      );
      sessionUaid = candidate;
      break;
    } catch (error) {
      lastSessionError = error;
      logger.warn(`UAID ${candidate} unavailable: ${describeError(error)}`);
    }
  }
  if (!session || !sessionUaid) {
    throw (
      lastSessionError ??
      new Error('Unable to create a chat session using UAID candidates.')
    );
  }
  logger.info('Session UAID:', sessionUaid);
  logger.info('Session:', pretty(session.result));
  const sessionId = requireSessionId(session);

  logSection('Sending Message');
  const messageRaw = await registryTool.invoke({
    operation: 'chat.sendMessage',
    payload: {
      sessionId,
      message: 'Hello from the Hedera Agent Kit demo script!',
    },
  });
  const message = parseToolResponse(messageRaw, 'Send message');
  logger.info('Message response:', pretty(message.result));

  logSection('Fetching History Snapshot');
  const historyRaw = await registryTool.invoke({
    operation: 'chat.getHistory',
    payload: {
      sessionId,
      limit: 5,
    },
  });
  const history = parseToolResponse(historyRaw, 'History');
  const entries = history.result?.entries;
  const entryCount = Array.isArray(entries) ? entries.length : 0;
  logger.info('History entries:', entryCount);

  logSection('Ending Session');
  const endRaw = await registryTool.invoke({
    operation: 'chat.endSession',
    payload: { sessionId },
  });
  const endParsed = parseToolResponse(endRaw, 'End session');
  logger.info('End session result:', pretty(endParsed.result));

  logSection('Demo Complete');
  process.exit(0);
};

main().catch((error) => {
  logger.error('Hedera Agent Kit demo failed:', error);
  process.exitCode = 1;
});
