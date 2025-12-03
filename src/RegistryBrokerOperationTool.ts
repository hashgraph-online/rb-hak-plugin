import { z } from 'zod';
import {
  RegistryBrokerClient,
  RegistryBrokerParseError,
  SearchParams,
  VectorSearchRequest,
  AgentRegistrationRequest,
  RegisterAgentOptions,
  LedgerChallengeRequest,
  LedgerVerifyRequest,
  LedgerCredentialAuthOptions,
  CreateSessionRequestPayload,
  SendMessageRequestPayload,
  CompactHistoryRequestPayload,
  EncryptionHandshakeSubmissionPayload,
  StartEncryptedChatSessionOptions,
  AcceptEncryptedChatSessionOptions,
  StartConversationOptions,
  AcceptConversationOptions,
  ChatHistoryFetchOptions,
  RegisterEncryptionKeyPayload,
  DeriveSharedSecretOptions,
  EncryptCipherEnvelopeOptions,
  DecryptCipherEnvelopeOptions,
  EnsureAgentKeyOptions,
  InitializeAgentClientOptions,
  ChatHistoryEntry,
  StartChatOptions,
} from '@hashgraphonline/standards-sdk';
import type { Context, Tool } from 'hedera-agent-kit';
import type {
  HederaOperatorClient,
  RegistryBrokerClientProvider,
} from './RegistryBrokerClientProvider';
import { RegistryBrokerConversationStore } from './RegistryBrokerConversationStore';

const nonEmptyString = (label: string): z.ZodString =>
  z
    .string({
      required_error: `${label} is required`,
      invalid_type_error: `${label} must be a string`,
    })
    .min(1, `${label} cannot be empty`);

const objectLike = <T>(label: string): z.ZodType<T> =>
  z.custom<T>(
    value => typeof value === 'object' && value !== null,
    `${label} must be an object`,
  );

const registrySearchParamsSchema: z.ZodType<SearchParams> = z
  .object({
    q: z.string().optional(),
    page: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
    registry: z.string().optional(),
    registries: z.array(z.string()).optional(),
    capabilities: z.array(z.string()).optional(),
    protocols: z.array(z.string()).optional(),
    minTrust: z.number().min(0).max(100).optional(),
    adapters: z.array(z.string()).optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    type: z.string().optional(),
    verified: z.boolean().optional(),
    online: z.boolean().optional(),
    metadata: z
      .record(
        z.array(z.union([z.string(), z.number(), z.boolean()])),
      )
      .optional(),
  })
  .partial();

type RegistryBrokerInputSchema = z.ZodObject<
  Record<string, z.ZodTypeAny>
>;

const registryBrokerInputSchema: RegistryBrokerInputSchema = z.object({
  operation: z.string(),
  payload: z.unknown().optional(),
});
type RegistryBrokerToolInput = {
  operation: string;
  payload?: unknown;
};

type OperationPath = string;

type MethodOperationDefinition =
  | { type: 'noArgs'; path: OperationPath }
  | {
      type: 'string';
      path: OperationPath;
      field: string;
      optional?: boolean;
    }
  | { type: 'object'; path: OperationPath; schema: z.ZodTypeAny }
  | {
      type: 'tuple';
      path: OperationPath;
      schema: z.ZodTypeAny;
      mapArgs: (payload: unknown) => unknown[];
    };

type CustomOperationDefinition = {
  type: 'custom';
  schema: z.ZodTypeAny;
  handler: (payload: unknown) => Promise<unknown>;
};

type OperationDefinition = MethodOperationDefinition | CustomOperationDefinition;

const noArgs = (path: string): MethodOperationDefinition => ({
  type: 'noArgs',
  path,
});

const stringArg = (
  path: string,
  field: string,
  optional = false,
): MethodOperationDefinition => ({
  type: 'string',
  path,
  field,
  optional,
});

const objectArg = (
  path: string,
  schema: z.ZodTypeAny,
): MethodOperationDefinition => ({
  type: 'object',
  path,
  schema,
});

const tupleArg = <TSchema extends z.ZodTypeAny>(
  path: string,
  schema: TSchema,
  mapArgs: (payload: z.infer<TSchema>) => unknown[],
): MethodOperationDefinition => ({
  type: 'tuple',
  path,
  schema,
  mapArgs: (payload: unknown) => mapArgs(payload as z.infer<TSchema>),
});

export const REGISTRY_BROKER_OPERATION_TOOL_NAME = 'registry_broker_operation';

export class RegistryBrokerOperationTool {
  private readonly clientProvider: RegistryBrokerClientProvider;
  private readonly handleStore: RegistryBrokerConversationStore;

  constructor(params: {
    clientProvider: RegistryBrokerClientProvider;
    handleStore: RegistryBrokerConversationStore;
  }) {
    this.clientProvider = params.clientProvider;
    this.handleStore = params.handleStore;
  }

  toTool(): Tool {
    return {
      method: REGISTRY_BROKER_OPERATION_TOOL_NAME,
      name: 'Registry Broker Operation',
      description:
        'Invoke registry-broker client methods (search, chat, registry lifecycle, ledger auth, encryption).',
      parameters: registryBrokerInputSchema,
      execute: async (hederaClient, agentContext, input) =>
        this.execute({
          rawInput: input,
          hederaClient: hederaClient as HederaOperatorClient | undefined,
          agentContext,
        }),
    };
  }

  private async execute(params: {
    rawInput: unknown;
    hederaClient?: HederaOperatorClient;
    agentContext?: Context;
  }): Promise<unknown> {
    const { rawInput, hederaClient } = params;
    const parsedInput = registryBrokerInputSchema.parse(rawInput) as RegistryBrokerToolInput;
    try {
      if (CONVERSATION_OPERATIONS.has(parsedInput.operation)) {
        const result = await this.handleConversationOperation(parsedInput);
        return this.wrapResult(parsedInput.operation, result);
      }
      if (parsedInput.operation === 'initializeAgent') {
        const initialised = await this.handleInitializeAgent(parsedInput.payload);
        return this.wrapResult(parsedInput.operation, initialised);
      }
      const definition = OPERATION_DEFINITIONS[parsedInput.operation];
      if (!definition) {
        throw new Error(
          `Unsupported registry broker operation: ${parsedInput.operation}`,
        );
      }
      if (definition.type === 'custom') {
        const parsed = definition.schema.parse(parsedInput.payload as unknown);
        const customResult = await definition.handler(parsed);
        return this.wrapResult(parsedInput.operation, customResult);
      }
      const client = await this.clientProvider.getClient({ hederaClient });
      const target = this.resolveTarget(client, definition.path);
      if (typeof target !== 'function') {
        throw new Error(`Method "${definition.path}" is unavailable on the client`);
      }
      if (definition.type === 'noArgs') {
        const result = await target.call(client);
        return this.wrapResult(parsedInput.operation, result);
      }
      if (definition.type === 'string') {
        const schema = z
          .object({
            [definition.field]: definition.optional
              ? z.string().optional()
              : nonEmptyString(definition.field),
          })
          .strict();
        const parsed = schema.parse(
          definition.optional && parsedInput.payload === undefined
            ? {}
            : ((parsedInput.payload as Record<string, unknown> | undefined) ??
                {}),
        );
        const arg = parsed[definition.field];
        const result = await target.call(client, arg);
        return this.wrapResult(parsedInput.operation, result);
      }
      if (definition.type === 'object') {
        const parsed = definition.schema.parse(
          (parsedInput.payload ?? {}) as Record<string, unknown>,
        );
        const result = await target.call(client, parsed);
        return this.wrapResult(parsedInput.operation, result);
      }
      if (definition.type === 'tuple') {
        const parsed = definition.schema.parse(
          (parsedInput.payload ?? {}) as Record<string, unknown>,
        );
        const args = definition.mapArgs(parsed);
        const result = await target.apply(client, args);
        return this.wrapResult(parsedInput.operation, result);
      }
      return null;
    } catch (error) {
      if (error instanceof RegistryBrokerParseError) {
        return {
          success: true,
          operation: parsedInput.operation,
          result: {
            parsed: false,
            error: error.message,
            raw: error.rawValue ?? null,
          },
        };
      }
      throw error;
    }
  }

  private async handleConversationOperation(
    input: RegistryBrokerToolInput,
  ): Promise<unknown> {
    switch (input.operation) {
      case 'conversation.send': {
        const parsed = conversationSendSchema.parse(input.payload ?? {});
        const handle = this.handleStore.get(String(parsed.handleId));
        return handle.send(parsed.payload);
      }
      case 'conversation.decryptHistoryEntry': {
        const parsed = conversationDecryptSchema.parse(input.payload ?? {});
        const handle = this.handleStore.get(String(parsed.handleId));
        return handle.decryptHistoryEntry(parsed.entry);
      }
      case 'conversation.release': {
        const parsed = conversationReleaseSchema.parse(input.payload ?? {});
        return this.handleStore.release(String(parsed.handleId));
      }
      default:
        throw new Error(`Unsupported conversation operation: ${input.operation}`);
    }
  }

  private async handleInitializeAgent(payload: unknown): Promise<unknown> {
    const parsed = initializeAgentSchema.parse(payload ?? {});
    const result = await RegistryBrokerClient.initializeAgent(parsed);
    return {
      encryption: result.encryption ?? null,
      defaultHeaders: result.client.getDefaultHeaders(),
    };
  }

  private resolveTarget(
    client: RegistryBrokerClient,
    path: string,
  ): unknown {
    return path.split('.').reduce((acc: unknown, key) => {
      if (acc && typeof acc === 'object') {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, client);
  }

  private wrapResult(operation: string, result: unknown): unknown {
    const mapped = this.mapResult(operation, result);
    return {
      success: true,
      operation,
      result: mapped,
    };
  }

  private mapResult(
    operation: string,
    result: unknown,
  ): unknown {
    if (this.isConversationHandle(result)) {
      const stored = this.handleStore.register(result);
      return {
        handleId: stored.handleId,
        sessionId: stored.sessionId,
        mode: stored.mode,
        summary: stored.summary ?? null,
      };
    }
    if (operation === 'getDefaultHeaders' && typeof result === 'object') {
      return result;
    }
    return result;
  }

  private isConversationHandle(
    value: unknown,
  ): value is Parameters<RegistryBrokerConversationStore['register']>[0] {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.sessionId === 'string' &&
      typeof candidate.send === 'function' &&
      typeof candidate.decryptHistoryEntry === 'function'
    );
  }
}

const conversationOperations = [
  'conversation.send',
  'conversation.decryptHistoryEntry',
  'conversation.release',
] as const;

const CONVERSATION_OPERATIONS = new Set<string>(conversationOperations);

const conversationSendSchema = z.object({
  handleId: nonEmptyString('handleId'),
  payload: objectLike<Parameters<
    Parameters<RegistryBrokerConversationStore['register']>[0]['send']
  >[0]>('payload'),
});

const conversationDecryptSchema = z.object({
  handleId: nonEmptyString('handleId'),
  entry: objectLike<ChatHistoryEntry>('entry'),
});

const conversationReleaseSchema = z.object({
  handleId: nonEmptyString('handleId'),
});

const vectorSearchSchema =
  objectLike<VectorSearchRequest>('vectorSearchRequest');

const registerAgentSchema = z.object({
  payload: objectLike<AgentRegistrationRequest>('registerAgentPayload'),
  options: objectLike<RegisterAgentOptions>('registerAgentOptions').optional(),
});

const updateAgentSchema = z.object({
  uaid: nonEmptyString('uaid'),
  request: objectLike<AgentRegistrationRequest>('request'),
});

const waitForRegistrationSchema = z.object({
  attemptId: nonEmptyString('attemptId'),
  options: objectLike<{
    intervalMs?: number;
    timeoutMs?: number;
    throwOnFailure?: boolean;
  }>('options').optional(),
});

const registryNamespaceSchema = z.object({
  registry: nonEmptyString('registry'),
  namespace: nonEmptyString('namespace'),
});

const ledgerChallengeSchema =
  objectLike<LedgerChallengeRequest>('ledgerChallenge');

const ledgerVerifySchema =
  objectLike<LedgerVerifyRequest>('ledgerVerifyRequest');

const ledgerAuthSchema =
  objectLike<LedgerCredentialAuthOptions>('ledgerCredentialAuth');

const createSessionSchema =
  objectLike<CreateSessionRequestPayload>('createSessionPayload');

const sendMessageSchema =
  objectLike<SendMessageRequestPayload>('sendMessagePayload');

const chatHistorySchema = z.object({
  sessionId: nonEmptyString('sessionId'),
  options: objectLike<ChatHistoryFetchOptions>('historyOptions').optional(),
});

const submitHandshakeSchema = z.object({
  sessionId: nonEmptyString('sessionId'),
  payload: objectLike<EncryptionHandshakeSubmissionPayload>(
    'handshakePayload',
  ),
});

const setDefaultHeaderSchema = z.object({
  name: nonEmptyString('name'),
  value: z.string().optional(),
});

const compactHistorySchema =
  objectLike<CompactHistoryRequestPayload>('compactHistoryPayload');

const registerKeySchema =
  objectLike<RegisterEncryptionKeyPayload>('registerEncryptionKeyPayload');

const deriveSecretSchema =
  objectLike<DeriveSharedSecretOptions>('deriveSharedSecretOptions');

const encryptEnvelopeSchema =
  objectLike<EncryptCipherEnvelopeOptions>('encryptCipherEnvelopeOptions');

const decryptEnvelopeSchema =
  objectLike<DecryptCipherEnvelopeOptions>('decryptCipherEnvelopeOptions');

const ensureAgentKeySchema =
  objectLike<EnsureAgentKeyOptions>('ensureAgentKeyOptions');

const generateKeyPairSchema = z
  .object({
    keyType: z.enum(['secp256k1']).optional(),
    envVar: z.string().optional(),
    envPath: z.string().optional(),
    overwrite: z.boolean().optional(),
  })
  .partial()
  .optional();

const startChatSchema =
  objectLike<StartChatOptions>('startChatOptions');

const startConversationSchema =
  objectLike<StartConversationOptions>('startConversationOptions');

const acceptConversationSchema =
  objectLike<AcceptConversationOptions>('acceptConversationOptions');

const startEncryptedSessionSchema =
  objectLike<StartEncryptedChatSessionOptions>(
    'startEncryptedSessionOptions',
  );

const acceptEncryptedSessionSchema =
  objectLike<AcceptEncryptedChatSessionOptions>(
    'acceptEncryptedSessionOptions',
  );

const initializeAgentSchema =
  objectLike<InitializeAgentClientOptions>('initializeAgentOptions');

const OPERATION_DEFINITIONS: Record<string, OperationDefinition> = {
  stats: noArgs('stats'),
  registries: noArgs('registries'),
  getAdditionalRegistries: noArgs('getAdditionalRegistries'),
  popularSearches: noArgs('popularSearches'),
  adapters: noArgs('adapters'),
  adaptersDetailed: noArgs('adaptersDetailed'),
  listProtocols: noArgs('listProtocols'),
  searchStatus: noArgs('searchStatus'),
  websocketStats: noArgs('websocketStats'),
  metricsSummary: noArgs('metricsSummary'),
  dashboardStats: noArgs('dashboardStats'),
  getX402Minimums: noArgs('getX402Minimums'),
  encryptionReady: noArgs('encryptionReady'),
  getDefaultHeaders: noArgs('getDefaultHeaders'),
  setApiKey: stringArg('setApiKey', 'apiKey', true),
  setLedgerApiKey: stringArg('setLedgerApiKey', 'apiKey', true),
  resolveUaid: stringArg('resolveUaid', 'uaid'),
  validateUaid: stringArg('validateUaid', 'uaid'),
  getUaidConnectionStatus: stringArg(
    'getUaidConnectionStatus',
    'uaid',
  ),
  closeUaidConnection: stringArg('closeUaidConnection', 'uaid'),
  facets: stringArg('facets', 'adapter', true),
  search: objectArg('search', registrySearchParamsSchema),
  vectorSearch: objectArg('vectorSearch', vectorSearchSchema),
  registrySearchByNamespace: tupleArg(
    'registrySearchByNamespace',
    registryNamespaceSchema,
    (payload: z.infer<typeof registryNamespaceSchema>) => [
      payload.registry,
      payload.namespace,
    ],
  ),
  registerAgent: tupleArg(
    'registerAgent',
    registerAgentSchema,
    (payload: z.infer<typeof registerAgentSchema>) => [
      payload.payload,
      payload.options,
    ],
  ),
  getRegistrationQuote: objectArg(
    'getRegistrationQuote',
    objectLike<AgentRegistrationRequest>('getRegistrationQuotePayload'),
  ),
  updateAgent: tupleArg(
    'updateAgent',
    updateAgentSchema,
    (payload: z.infer<typeof updateAgentSchema>) => [
      payload.uaid,
      payload.request,
    ],
  ),
  getRegistrationProgress: stringArg(
    'getRegistrationProgress',
    'attemptId',
  ),
  waitForRegistrationCompletion: tupleArg(
    'waitForRegistrationCompletion',
    waitForRegistrationSchema,
    (payload: z.infer<typeof waitForRegistrationSchema>) => [
      payload.attemptId,
      payload.options,
    ],
  ),
  purchaseCreditsWithHbar: objectArg(
    'purchaseCreditsWithHbar',
    objectLike('purchaseCreditsWithHbar'),
  ),
  purchaseCreditsWithX402: objectArg(
    'purchaseCreditsWithX402',
    objectLike('purchaseCreditsWithX402'),
  ),
  buyCreditsWithX402: objectArg(
    'buyCreditsWithX402',
    objectLike('buyCreditsWithX402'),
  ),
  createLedgerChallenge: objectArg(
    'createLedgerChallenge',
    ledgerChallengeSchema,
  ),
  verifyLedgerChallenge: objectArg(
    'verifyLedgerChallenge',
    ledgerVerifySchema,
  ),
  authenticateWithLedger: objectArg(
    'authenticateWithLedger',
    ledgerAuthSchema,
  ),
  authenticateWithLedgerCredentials: objectArg(
    'authenticateWithLedgerCredentials',
    ledgerAuthSchema,
  ),
  detectProtocol: objectArg('detectProtocol', objectLike('detectProtocol')),
  setDefaultHeader: tupleArg(
    'setDefaultHeader',
    setDefaultHeaderSchema,
    (payload: z.infer<typeof setDefaultHeaderSchema>) => [
      payload.name,
      payload.value,
    ],
  ),
  'chat.start': objectArg('chat.start', startChatSchema),
  'chat.createSession': objectArg('chat.createSession', createSessionSchema),
  'chat.sendMessage': objectArg('chat.sendMessage', sendMessageSchema),
  'chat.endSession': stringArg('chat.endSession', 'sessionId'),
  'chat.getHistory': tupleArg(
    'chat.getHistory',
    chatHistorySchema,
    (payload: z.infer<typeof chatHistorySchema>) => [
      payload.sessionId,
      payload.options,
    ],
  ),
  'chat.compactHistory': objectArg(
    'chat.compactHistory',
    compactHistorySchema,
  ),
  'chat.getEncryptionStatus': stringArg(
    'chat.getEncryptionStatus',
    'sessionId',
  ),
  'chat.submitEncryptionHandshake': tupleArg(
    'chat.submitEncryptionHandshake',
    submitHandshakeSchema,
    (payload: z.infer<typeof submitHandshakeSchema>) => [
      payload.sessionId,
      payload.payload,
    ],
  ),
  'chat.createEncryptedSession': objectArg(
    'chat.createEncryptedSession',
    startEncryptedSessionSchema,
  ),
  'chat.acceptEncryptedSession': objectArg(
    'chat.acceptEncryptedSession',
    acceptEncryptedSessionSchema,
  ),
  'chat.startConversation': objectArg(
    'chat.startConversation',
    startConversationSchema,
  ),
  'chat.acceptConversation': objectArg(
    'chat.acceptConversation',
    acceptConversationSchema,
  ),
  'encryption.registerKey': objectArg(
    'encryption.registerKey',
    registerKeySchema,
  ),
  'encryption.generateEphemeralKeyPair': noArgs(
    'encryption.generateEphemeralKeyPair',
  ),
  'encryption.deriveSharedSecret': objectArg(
    'encryption.deriveSharedSecret',
    deriveSecretSchema,
  ),
  'encryption.encryptCipherEnvelope': objectArg(
    'encryption.encryptCipherEnvelope',
    encryptEnvelopeSchema,
  ),
  'encryption.decryptCipherEnvelope': objectArg(
    'encryption.decryptCipherEnvelope',
    decryptEnvelopeSchema,
  ),
  'encryption.ensureAgentKey': objectArg(
    'encryption.ensureAgentKey',
    ensureAgentKeySchema,
  ),
  generateEncryptionKeyPair: objectArg(
    'generateEncryptionKeyPair',
    generateKeyPairSchema,
  ),
};
