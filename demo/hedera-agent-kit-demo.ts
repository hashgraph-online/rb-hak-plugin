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
        'ACCOUNT_ID',
        'HEDERA_ACCOUNT_ID',
      ])
    : requireEnvFromKeys('Hedera account ID', [
        'HEDERA_OPERATOR_ID',
        'ACCOUNT_ID',
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
  client.setOperator(accountId, PrivateKey.fromString(privateKey));
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

type SearchHit = Record<string, unknown>;
type HistoryEntry = {
  role?: unknown;
  content?: unknown;
};

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

const buildPrincipalSenderUaid = (accountId: string): string =>
  `principal:ledger:${accountId}`;

const isHtmlDocumentText = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith('<!doctype html') ||
    normalized.startsWith('<html') ||
    normalized.includes('<html')
  );
};

const isUsableAgentText = (value: string): boolean =>
  value.trim().length > 0 && !isHtmlDocumentText(value);

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

const mergeSearchHits = (...groups: SearchHit[][]): SearchHit[] => {
  const seen = new Set<string>();
  const merged: SearchHit[] = [];
  for (const group of groups) {
    for (const hit of group) {
      const uaid = typeof hit.uaid === 'string' ? hit.uaid.trim() : '';
      const key = uaid || JSON.stringify(hit);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(hit);
    }
  }
  return merged;
};

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
  const registry = typeof hit.registry === 'string' ? hit.registry.trim().toLowerCase() : '';
  const allowStaleA2ARegistryTarget = registry === 'a2a-registry';
  if (available === false && !allowStaleA2ARegistryTarget) {
    return false;
  }
  const protocols = asStringArray(hit.protocols).map((protocol) =>
    protocol.trim().toLowerCase()
  );
  return protocols.some((protocol) => chatProtocolPriority.includes(protocol as (typeof chatProtocolPriority)[number]));
};

const compareChatCandidatePriority = (left: SearchHit, right: SearchHit): number => {
  const leftProtocols = asStringArray(left.protocols).map((protocol) =>
    protocol.trim().toLowerCase()
  );
  const rightProtocols = asStringArray(right.protocols).map((protocol) =>
    protocol.trim().toLowerCase()
  );
  const leftRank = chatProtocolPriority.findIndex((protocol) =>
    leftProtocols.includes(protocol)
  );
  const rightRank = chatProtocolPriority.findIndex((protocol) =>
    rightProtocols.includes(protocol)
  );
  const normalizedLeftRank = leftRank === -1 ? Number.MAX_SAFE_INTEGER : leftRank;
  const normalizedRightRank =
    rightRank === -1 ? Number.MAX_SAFE_INTEGER : rightRank;
  if (normalizedLeftRank !== normalizedRightRank) {
    return normalizedLeftRank - normalizedRightRank;
  }
  const leftTrust = typeof left.trustScore === 'number' ? left.trustScore : -1;
  const rightTrust = typeof right.trustScore === 'number' ? right.trustScore : -1;
  return rightTrust - leftTrust;
};

const collectChatCandidateUaids = (hits: SearchHit[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  const sortedHits = [...hits].filter(isChatCapableHit).sort(compareChatCandidatePriority);
  for (const hit of sortedHits) {
    const candidate = typeof hit.uaid === 'string' ? hit.uaid.trim() : '';
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
};

const extractHistoryEntries = (response: ToolResponse): unknown[] => {
  const directEntries = response.result?.entries;
  if (Array.isArray(directEntries)) {
    return directEntries;
  }
  const historyEntries = response.result?.history;
  if (Array.isArray(historyEntries)) {
    return historyEntries;
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
  entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const candidate = entry as HistoryEntry;
    if (candidate.role !== 'assistant' || typeof candidate.content !== 'string') {
      return [];
    }
    const content = candidate.content.trim();
    return isUsableAgentText(content) ? [content] : [];
  });

const extractDelegateSummary = (response: ToolResponse): Record<string, unknown> => {
  if (response.result && typeof response.result === 'object') {
    return response.result;
  }
  return {};
};

const pretty = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  const serialised = JSON.stringify(value, null, 2);
  return serialised ? serialised.replace(/"([^"]+)":/g, '"$1":') : '';
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const extractMessageText = (response: ToolResponse): string => {
  const message = response.result?.message;
  return typeof message === 'string' ? message.trim() : '';
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

const resolveDemoUaids = (
  prioritizedUaids: string[],
  hits: SearchHit[]
): string[] =>
  uniqueValues([
    process.env.REGISTRY_BROKER_DEMO_UAID,
    ...prioritizedUaids,
    ...collectChatCandidateUaids(hits),
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

const fetchHistory = async (
  registryTool: { invoke: (input: unknown) => Promise<string> },
  sessionId: string
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
  return parseToolResponse(historyRaw, 'History');
};

const waitForAgentOutput = async (
  registryTool: { invoke: (input: unknown) => Promise<string> },
  sessionId: string,
  initialMessage: ToolResponse
): Promise<ToolResponse> => {
  const initialText = extractMessageText(initialMessage);
  if (isUsableAgentText(initialText)) {
    return initialMessage;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await sleep(1500);
    const history = await fetchHistory(registryTool, sessionId);
    const entries = extractHistoryEntries(history);
    if (extractAssistantOutput(entries).length > 0) {
      return history;
    }
  }
  throw new Error('Chat exchange completed without agent output.');
};

const main = async (): Promise<void> => {
  const { client, network, accountId } = createHederaClient();
  const senderUaid = buildPrincipalSenderUaid(accountId);

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

  const pingSearchRaw = await registryTool.invoke({
    operation: 'search',
    payload: {
      q: 'Registry Ping Agent',
      registries: ['a2a-registry'],
      limit: 5,
    },
  });
  const pingSearch = parseToolResponse(pingSearchRaw, 'Ping agent search');

  const registrySearchRaw = await registryTool.invoke({
    operation: 'search',
    payload: {
      online: true,
      limit: 25,
    },
  });
  const registrySearch = parseToolResponse(registrySearchRaw, 'Search');
  const pingCandidateUaids = extractSearchHits(pingSearch)
    .map((hit) => (typeof hit.uaid === 'string' ? hit.uaid.trim() : ''))
    .filter((uaid) => uaid.length > 0);
  const searchHits = mergeSearchHits(
    extractSearchHits(pingSearch),
    extractSearchHits(registrySearch)
  );
  logSection('Active Agent Search Results');
  logger.info(pretty(searchHits.slice(0, 5)));

  const delegateRaw = await registryTool.invoke({
    operation: 'delegate',
    payload: {
      task: 'Find the best delegate for a TypeScript plugin integration fix.',
      context:
        'Prefer candidates that can work on Registry Broker, SDKs, plugins, and verification.',
      limit: 3,
      filter: {
        protocols: ['mcp', 'a2a'],
        adapters: ['codex'],
      },
    },
  });
  const delegateResponse = parseToolResponse(delegateRaw, 'Delegate');
  logSection('Delegate Recommendation');
  logger.info(pretty(extractDelegateSummary(delegateResponse)));

  const uaidCandidates = resolveDemoUaids(pingCandidateUaids, searchHits);

  logSection('Starting Chat Session');
  let session: ToolResponse | null = null;
  let message: ToolResponse | null = null;
  let historySnapshot: ToolResponse | null = null;
  let sessionUaid: string | null = null;
  let lastSessionError: unknown;
  for (const candidate of uaidCandidates) {
    let candidateSessionId: string | null = null;
    try {
      const startSessionRaw = await registryTool.invoke({
        operation: 'chat.createSession',
        payload: {
          uaid: candidate,
          historyTtlSeconds: 300,
          senderUaid,
        },
      });
      session = parseToolResponse(
        startSessionRaw,
        `Create session (${candidate})`
      );
      candidateSessionId = requireSessionId(session);
      const messageRaw = await registryTool.invoke({
        operation: 'chat.sendMessage',
        payload: {
          sessionId: candidateSessionId,
          message: verificationPrompt,
          senderUaid,
        },
      });
      message = parseToolResponse(messageRaw, `Send message (${candidate})`);
      historySnapshot = await waitForAgentOutput(
        registryTool,
        candidateSessionId,
        message
      );
      sessionUaid = candidate;
      break;
    } catch (error) {
      lastSessionError = error;
      logger.warn(`UAID ${candidate} unavailable: ${describeError(error)}`);
      if (candidateSessionId) {
        try {
          await registryTool.invoke({
            operation: 'chat.endSession',
            payload: { sessionId: candidateSessionId },
          });
        } catch (endError) {
          logger.warn(
            `Failed to end unsuccessful session ${candidateSessionId}: ${describeError(endError)}`
          );
        }
      }
    }
  }
  if (!session || !sessionUaid || !message || !historySnapshot) {
    throw (
      lastSessionError ??
      new Error('Unable to complete a chat exchange using UAID candidates.')
    );
  }
  logger.info('Session UAID:', sessionUaid);
  logger.info('Session:', pretty(session.result));
  const sessionId = requireSessionId(session);

  logSection('Sending Message');
  logger.info('Message response:', pretty(message.result));

  logSection('Fetching History Snapshot');
  const entries = extractHistoryEntries(historySnapshot);
  const entryCount = Array.isArray(entries) ? entries.length : 0;
  logger.info('History entries:', entryCount);
  const assistantOutput = extractAssistantOutput(entries);
  if (assistantOutput.length > 0) {
    logger.info('Assistant output:', pretty(assistantOutput));
  }

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
