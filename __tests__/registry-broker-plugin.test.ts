import { jest } from '@jest/globals';
import { Buffer } from 'node:buffer';
import { RegistryBrokerClient } from '@hashgraphonline/standards-sdk';
import {
  RegistryBrokerClientProvider,
  type HederaOperatorClient,
} from '../src/RegistryBrokerClientProvider';
import { RegistryBrokerConversationStore } from '../src/RegistryBrokerConversationStore';
import {
  RegistryBrokerOperationTool,
  REGISTRY_BROKER_OPERATION_TOOL_NAME,
} from '../src/RegistryBrokerOperationTool';
import { createRegistryBrokerPlugin } from '../src/RegistryBrokerPlugin';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('RegistryBrokerClientProvider', () => {
  const logger = createLogger();
  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.REGISTRY_BROKER_API_KEY;
    delete process.env.REGISTRY_BROKER_LEDGER_KEY;
    delete process.env.HEDERA_OPERATOR_ID;
    delete process.env.HEDERA_OPERATOR_KEY;
    delete process.env.HEDERA_ACCOUNT_ID;
    delete process.env.HEDERA_PRIVATE_KEY;
    delete process.env.MAINNET_HEDERA_ACCOUNT_ID;
    delete process.env.MAINNET_HEDERA_PRIVATE_KEY;
    delete process.env.HEDERA_NETWORK;
  });

  it('derives ledger auth from a Hedera client operator when available', async () => {
    const transactionSigner = jest
      .fn()
      .mockResolvedValue(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    const hederaClient: HederaOperatorClient = {
      getOperator: () => ({
        accountId: { toString: () => '0.0.111' },
        publicKey: { toString: () => '302a300506032b6570032100' },
        transactionSigner,
      }),
      ledgerId: {
        isMainnet: () => true,
        isPreviewnet: () => false,
        isTestnet: () => false,
        toString: () => 'mainnet',
      },
    };
    const mockClient = {
      authenticateWithLedgerCredentials: jest.fn().mockResolvedValue(undefined),
    };
    const provider = new RegistryBrokerClientProvider(
      undefined,
      logger,
      () => mockClient as unknown as RegistryBrokerClient,
    );
    await provider.getClient({ hederaClient });
    expect(
      mockClient.authenticateWithLedgerCredentials,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: '0.0.111',
        network: 'hedera:mainnet',
        label: 'Hedera Agent Kit operator',
      }),
    );
    const signFn =
      mockClient.authenticateWithLedgerCredentials.mock.calls[0][0].sign;
    await expect(signFn('hello world')).resolves.toEqual({
      signature: Buffer.from([0xde, 0xad, 0xbe, 0xef]).toString('base64'),
      signatureKind: 'raw',
      publicKey: '302a300506032b6570032100',
    });
    expect(transactionSigner).toHaveBeenCalledWith(Buffer.from('hello world', 'utf8'));
  });

  it('merges environment defaults when config is missing', async () => {
    process.env.REGISTRY_BROKER_API_KEY = 'rbk_test_key';
    const mockClient = { authenticateWithLedgerCredentials: jest.fn() };
    const factory = jest
      .fn()
      .mockReturnValue(mockClient as unknown as RegistryBrokerClient);
    const provider = new RegistryBrokerClientProvider(undefined, logger, factory);
    await provider.getClient();
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'rbk_test_key' }),
    );
    expect(mockClient.authenticateWithLedgerCredentials).not.toHaveBeenCalled();
  });

  it('performs ledger authentication when credentials are supplied', async () => {
    const mockClient = {
      authenticateWithLedgerCredentials: jest.fn().mockResolvedValue(undefined),
    };
    const provider = new RegistryBrokerClientProvider(
      {
        ledger: {
          accountId: '0.0.123',
          network: 'hedera:testnet',
          hederaPrivateKey: '302e0101',
        },
      },
      logger,
      () => mockClient as unknown as RegistryBrokerClient,
    );
    await provider.getClient();
    expect(
      mockClient.authenticateWithLedgerCredentials,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: '0.0.123', network: 'hedera:testnet' }),
    );
  });

  it('reuses the same client instance', async () => {
    const mockClient = { authenticateWithLedgerCredentials: jest.fn() };
    const factory = jest
      .fn()
      .mockReturnValue(mockClient as unknown as RegistryBrokerClient);
    const provider = new RegistryBrokerClientProvider(undefined, logger, factory);
    const first = await provider.getClient();
    const second = await provider.getClient();
    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('respects disableEnvApiKey flag', async () => {
    process.env.REGISTRY_BROKER_API_KEY = 'env_key';
    const mockClient = { authenticateWithLedgerCredentials: jest.fn() };
    const factory = jest
      .fn()
      .mockReturnValue(mockClient as unknown as RegistryBrokerClient);
    const provider = new RegistryBrokerClientProvider(
      {
        client: {
          disableEnvApiKey: true,
        },
      },
      logger,
      factory,
    );
    await provider.getClient();
    expect(factory).toHaveBeenCalledWith(
      expect.not.objectContaining({ apiKey: 'env_key' }),
    );
  });

  it('authenticates via MAINNET_HEDERA_* env defaults when provided', async () => {
    process.env.MAINNET_HEDERA_ACCOUNT_ID = '0.0.456';
    process.env.MAINNET_HEDERA_PRIVATE_KEY = '302e01';
    const mockClient = {
      authenticateWithLedgerCredentials: jest.fn().mockResolvedValue(undefined),
    };
    const provider = new RegistryBrokerClientProvider(
      undefined,
      logger,
      () => mockClient as unknown as RegistryBrokerClient,
    );
    await provider.getClient();
    expect(
      mockClient.authenticateWithLedgerCredentials,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: '0.0.456',
        network: 'hedera:mainnet',
      }),
    );
  });

  it('authenticates via HEDERA_OPERATOR_* env defaults when provided', async () => {
    process.env.HEDERA_OPERATOR_ID = '0.0.789';
    process.env.HEDERA_OPERATOR_KEY = 'abcd1234';
    process.env.HEDERA_NETWORK = 'hedera:testnet';
    const mockClient = {
      authenticateWithLedgerCredentials: jest.fn().mockResolvedValue(undefined),
    };
    const provider = new RegistryBrokerClientProvider(
      undefined,
      logger,
      () => mockClient as unknown as RegistryBrokerClient,
    );
    await provider.getClient();
    expect(
      mockClient.authenticateWithLedgerCredentials,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: '0.0.789',
        network: 'hedera:testnet',
      }),
    );
  });

});

describe('RegistryBrokerOperationTool', () => {
  const handleStore = new RegistryBrokerConversationStore();

  const createTool = (clientMock: Record<string, unknown>) => {
    const provider = {
      getClient: jest.fn().mockResolvedValue(clientMock),
    };
    const tool = new RegistryBrokerOperationTool({
      clientProvider: provider as any,
      handleStore,
    }).toTool();
    return { tool, provider };
  };

  const createHederaClientStub = (): HederaOperatorClient =>
    ({
      ledgerId: {
        isMainnet: () => false,
        isTestnet: () => true,
        isPreviewnet: () => false,
        toString: () => 'testnet',
      },
      getOperator: () => null,
    });

  const invokeTool = async (
    tool: ReturnType<RegistryBrokerOperationTool['toTool']>,
    payload: Record<string, unknown>,
    hederaClient: HederaOperatorClient = createHederaClientStub(),
  ) => tool.execute(hederaClient as any, { accountId: '0.0.100' } as any, payload);

  const createConversationHandle = () => ({
    sessionId: 'session-1',
    mode: 'plaintext' as const,
    summary: null,
    send: jest.fn().mockResolvedValue({ ok: true }),
    decryptHistoryEntry: jest.fn().mockReturnValue('plaintext'),
  });

  it('routes search and resolve operations to the client', async () => {
    const client = {
      search: jest.fn().mockResolvedValue({ hits: [] }),
      resolveUaid: jest.fn().mockResolvedValue({ agent: { uaid: 'uaid:test' } }),
      chat: {
        createSession: jest.fn().mockResolvedValue({ sessionId: 'abc123' }),
        start: jest.fn(),
      },
      encryption: {},
    };
    const { tool, provider } = createTool(client);
    const hederaClient = createHederaClientStub();
    const searchResult = await invokeTool(tool, {
      operation: 'search',
      payload: { q: 'cust support' },
    }, hederaClient);
    expect(client.search).toHaveBeenCalledWith({ q: 'cust support' });
    expect(searchResult.success).toBe(true);
    const resolveResult = await invokeTool(tool, {
      operation: 'resolveUaid',
      payload: { uaid: 'uaid:test' },
    }, hederaClient);
    expect(client.resolveUaid).toHaveBeenCalledWith('uaid:test');
    expect(resolveResult.success).toBe(true);
    expect(provider.getClient).toHaveBeenCalledWith({ hederaClient });
  });

  it('handles registerAgent and updateAgent payload mapping', async () => {
    const client = {
      registerAgent: jest.fn().mockResolvedValue({ success: true }),
      updateAgent: jest.fn().mockResolvedValue({ success: true }),
      chat: { start: jest.fn(), createSession: jest.fn() },
      encryption: {},
    };
    const { tool, provider } = createTool(client);
    const hederaClient = createHederaClientStub();
    await invokeTool(tool, {
      operation: 'registerAgent',
      payload: {
        payload: { registry: 'hashgraph-online' },
        options: { autoTopUp: { accountId: '0.0.1', privateKey: '302' } },
      },
    }, hederaClient);
    expect(client.registerAgent).toHaveBeenCalledWith(
      { registry: 'hashgraph-online' },
      { autoTopUp: { accountId: '0.0.1', privateKey: '302' } },
    );
    await invokeTool(tool, {
      operation: 'updateAgent',
      payload: { uaid: 'uaid:test', request: { endpoint: 'https://example.com' } },
    }, hederaClient);
    expect(client.updateAgent).toHaveBeenCalledWith('uaid:test', {
      endpoint: 'https://example.com',
    });
    expect(provider.getClient).toHaveBeenCalledWith({ hederaClient });
  });

  it('stores conversation handles and supports conversation.* helpers', async () => {
    const handle = createConversationHandle();
    const client = {
      chat: {
        start: jest.fn().mockResolvedValue(handle),
        createSession: jest.fn(),
      },
      encryption: {},
    };
    const { tool } = createTool(client);
    const response = await invokeTool(tool, {
      operation: 'chat.start',
      payload: { uaid: 'uaid:demo' },
    });
    const { handleId } = response.result as { handleId: string };
    await invokeTool(tool, {
      operation: 'conversation.send',
      payload: {
        handleId,
        payload: { plaintext: 'ping', message: 'ping' },
      },
    });
    expect(handle.send).toHaveBeenCalledWith({ plaintext: 'ping', message: 'ping' });
    await invokeTool(tool, {
      operation: 'conversation.release',
      payload: { handleId },
    });
  });

  it('forwards encryption helpers and generates key pairs', async () => {
    const client = {
      encryption: {
        registerKey: jest.fn().mockResolvedValue({ ok: true }),
        ensureAgentKey: jest.fn().mockResolvedValue({ publicKey: 'abc' }),
        generateEphemeralKeyPair: jest.fn(),
        deriveSharedSecret: jest.fn(),
        encryptCipherEnvelope: jest.fn(),
        decryptCipherEnvelope: jest.fn(),
      },
      generateEncryptionKeyPair: jest.fn().mockResolvedValue({ publicKey: 'pub' }),
      chat: { start: jest.fn(), createSession: jest.fn() },
    };
    const { tool, provider } = createTool(client);
    const hederaClient = createHederaClientStub();
    await invokeTool(tool, {
      operation: 'encryption.registerKey',
      payload: { keyType: 'secp256k1', publicKey: '01' },
    }, hederaClient);
    expect(client.encryption.registerKey).toHaveBeenCalled();

    await invokeTool(tool, {
      operation: 'generateEncryptionKeyPair',
      payload: { envVar: 'RB_KEY' },
    }, hederaClient);
    expect(client.generateEncryptionKeyPair).toHaveBeenCalledWith({
      envVar: 'RB_KEY',
    });
    expect(provider.getClient).toHaveBeenCalledWith({ hederaClient });
  });

  it('uses RegistryBrokerClient.initializeAgent for initializeAgent operation', async () => {
    const spy = jest
      .spyOn(RegistryBrokerClient, 'initializeAgent')
      .mockResolvedValue({
        client: { getDefaultHeaders: () => ({}) } as RegistryBrokerClient,
        encryption: { publicKey: 'abc' },
      });
    const client = { chat: { start: jest.fn(), createSession: jest.fn() }, encryption: {} };
    const { tool } = createTool(client);
    await invokeTool(tool, {
      operation: 'initializeAgent',
      payload: { uaid: 'uaid:test' },
    });
    expect(spy).toHaveBeenCalledWith({ uaid: 'uaid:test' });
  });
});

describe('RegistryBrokerPlugin', () => {
  it('exposes the registry broker operation tool through the plugin interface', () => {
    const plugin = createRegistryBrokerPlugin({ logger: createLogger() });
    const tools = plugin.tools({});
    expect(Array.isArray(tools)).toBe(true);
    expect(
      tools.find(tool => tool.method === REGISTRY_BROKER_OPERATION_TOOL_NAME),
    ).toBeDefined();
  });
});
