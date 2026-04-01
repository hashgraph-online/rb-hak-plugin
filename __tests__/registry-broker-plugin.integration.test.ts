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

const chatProtocolPriority = [
  'moltbook',
  'uagent',
  'a2a',
  'acp',
  'hcs-10',
  'mcp',
  'openrouter',
] as const;

const verificationPrompt =
  'Respond with READY and describe the capabilities or tools you support in one sentence.';

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
        'ACCOUNT_ID',
        'HEDERA_ACCOUNT_ID',
      ])
    : requireEnvValue('Ledger account', [
        'HEDERA_OPERATOR_ID',
        'ACCOUNT_ID',
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
  client.setOperator(accountId, PrivateKey.fromString(privateKey));
  return { client, network };
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type ToolResponse = {
  success?: boolean;
  error?: string;
  result?: Record<string, unknown>;
};

type SearchHit = Record<string, unknown>;
type HistoryEntry = {
  role?: unknown;
  content?: unknown;
};

const extractSearchHits = (response: ToolResponse): SearchHit[] => {
  const parsedResult = response.result?.parsed;
  if (parsedResult === false) {
    const rawHits = response.result?.raw;
    if (rawHits && typeof rawHits === 'object' && Array.isArray((rawHits as { hits?: unknown }).hits)) {
      return (rawHits as { hits: SearchHit[] }).hits;
    }
    return [];
  }
  const hits = response.result?.hits;
  return Array.isArray(hits) ? (hits as SearchHit[]) : [];
};

const extractHistoryEntries = (response: ToolResponse): unknown[] => {
  const directEntries = response.result?.entries;
  if (Array.isArray(directEntries)) {
    return directEntries;
  }
  if (Array.isArray(response.result)) {
    return response.result;
  }
  if (response.result?.parsed === false) {
    const raw = response.result?.raw;
    if (raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown }).entries)) {
      return (raw as { entries: unknown[] }).entries;
    }
  }
  return [];
};

const extractAssistantOutput = (entries: unknown[]): string[] =>
  entries.flatMap(entry => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const candidate = entry as HistoryEntry;
    if (candidate.role !== 'assistant' || typeof candidate.content !== 'string') {
      return [];
    }
    const content = candidate.content.trim();
    return content.length > 0 ? [content] : [];
  });

const extractMessageText = (response: ToolResponse): string => {
  const message = response.result?.message;
  return typeof message === 'string' ? message.trim() : '';
};

const sleep = async (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

const isChatCapableHit = (hit: SearchHit): boolean => {
  const communicationSupported = hit.communicationSupported;
  if (communicationSupported === false) {
    return false;
  }
  const available = hit.available;
  if (available === false) {
    return false;
  }
  const protocols = asStringArray(hit.protocols).map(protocol =>
    protocol.trim().toLowerCase(),
  );
  return protocols.some(protocol =>
    chatProtocolPriority.includes(protocol as (typeof chatProtocolPriority)[number]),
  );
};

const compareChatCandidatePriority = (left: SearchHit, right: SearchHit): number => {
  const leftProtocols = asStringArray(left.protocols).map(protocol =>
    protocol.trim().toLowerCase(),
  );
  const rightProtocols = asStringArray(right.protocols).map(protocol =>
    protocol.trim().toLowerCase(),
  );
  const leftRank = chatProtocolPriority.findIndex(protocol =>
    leftProtocols.includes(protocol),
  );
  const rightRank = chatProtocolPriority.findIndex(protocol =>
    rightProtocols.includes(protocol),
  );
  const normalizedLeftRank = leftRank === -1 ? Number.MAX_SAFE_INTEGER : leftRank;
  const normalizedRightRank = rightRank === -1 ? Number.MAX_SAFE_INTEGER : rightRank;
  if (normalizedLeftRank !== normalizedRightRank) {
    return normalizedLeftRank - normalizedRightRank;
  }
  const leftTrust = typeof left.trustScore === 'number' ? left.trustScore : -1;
  const rightTrust = typeof right.trustScore === 'number' ? right.trustScore : -1;
  return rightTrust - leftTrust;
};

const resolveDemoUaids = (hits: SearchHit[]): string[] => {
  const seen = new Set<string>();
  const ordered = [
    process.env.REGISTRY_BROKER_DEMO_UAID?.trim(),
    ...hits
      .filter(isChatCapableHit)
      .sort(compareChatCandidatePriority)
      .map(hit => (typeof hit.uaid === 'string' ? hit.uaid.trim() : '')),
    OPENROUTER_DEMO_UAID,
  ];
  const result: string[] = [];
  for (const candidate of ordered) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
};

const fetchHistory = async (
  registryTool: { invoke: (input: unknown) => Promise<string> },
  sessionId: string,
): Promise<ToolResponse> => {
  const historyRaw = await registryTool.invoke({
    operation: 'chat.getHistory',
    payload: {
      sessionId,
      options: {
        limit: 10,
      },
    },
  });
  return JSON.parse(historyRaw) as ToolResponse;
};

const waitForAgentOutput = async (
  registryTool: { invoke: (input: unknown) => Promise<string> },
  sessionId: string,
  initialMessage: ToolResponse,
): Promise<ToolResponse> => {
  if (extractMessageText(initialMessage).length > 0) {
    return initialMessage;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await sleep(1500);
    const history = await fetchHistory(registryTool, sessionId);
    if (history.success && extractAssistantOutput(extractHistoryEntries(history)).length > 0) {
      return history;
    }
  }
  throw new Error('chat exchange completed without agent output');
};

const createChatExchange = async (
  registryTool: { invoke: (input: unknown) => Promise<string> },
  uaids: string[],
): Promise<{
  session: ToolResponse;
  message: ToolResponse;
  history: ToolResponse;
  uaid: string;
}> => {
  let lastError: unknown;
  for (const candidate of uaids) {
    let sessionId: string | null = null;
    try {
      const raw = await registryTool.invoke({
        operation: 'chat.createSession',
        payload: { uaid: candidate, historyTtlSeconds: 180 },
      });
      const parsed = JSON.parse(raw) as ToolResponse;
      if (parsed?.success) {
        const resolvedSessionId = parsed.result?.sessionId;
        if (typeof resolvedSessionId !== 'string') {
          throw new Error('chat.createSession response is missing sessionId');
        }
        sessionId = resolvedSessionId;
        const messageRaw = await registryTool.invoke({
          operation: 'chat.sendMessage',
          payload: {
            sessionId,
            message: verificationPrompt,
          },
        });
        const message = JSON.parse(messageRaw) as ToolResponse;
        if (!message?.success) {
          throw new Error(
            message?.error ?? 'chat.sendMessage returned an unsuccessful response',
          );
        }
        const history = await waitForAgentOutput(registryTool, sessionId, message);
        return { session: parsed, message, history, uaid: candidate };
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
        `chat exchange failed for ${candidate}: ${describeError(error)}`,
      );
      if (sessionId) {
        try {
          await registryTool.invoke({
            operation: 'chat.endSession',
            payload: { sessionId },
          });
        } catch (endError) {
          logger.warn?.(
            `chat.endSession cleanup failed for ${candidate}: ${describeError(endError)}`,
          );
        }
      }
    }
  }
  throw lastError ?? new Error('Unable to complete chat exchange with any UAID candidate.');
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
        payload: {
          online: true,
          limit: 25,
        },
      });
      const searchParsed = JSON.parse(searchRaw) as ToolResponse;
      expect(searchParsed.success).toBe(true);
      const hits = extractSearchHits(searchParsed);
      expect(Array.isArray(hits)).toBe(true);

      const { session, message, history, uaid } = await createChatExchange(
        registryTool!,
        resolveDemoUaids(hits),
      );
      expect(session.success).toBe(true);
      expect(message.success).toBe(true);
      expect(history.success).toBe(true);
      expect(
        extractMessageText(message).length > 0 ||
          extractAssistantOutput(extractHistoryEntries(history)).length > 0,
      ).toBe(true);
      expect(typeof session.result.sessionId).toBe('string');
      logger.info?.(`chat.createSession succeeded for ${uaid}`);
      const sessionId: string = session.result.sessionId;

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
