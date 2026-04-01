export const registryBrokerOperationNames = [
  'stats',
  'registries',
  'getAdditionalRegistries',
  'popularSearches',
  'adapters',
  'adaptersDetailed',
  'listProtocols',
  'searchStatus',
  'websocketStats',
  'metricsSummary',
  'dashboardStats',
  'getX402Minimums',
  'encryptionReady',
  'getDefaultHeaders',
  'setApiKey',
  'setLedgerApiKey',
  'resolveUaid',
  'validateUaid',
  'getUaidConnectionStatus',
  'closeUaidConnection',
  'facets',
  'search',
  'delegate',
  'vectorSearch',
  'registrySearchByNamespace',
  'registerAgent',
  'getRegistrationQuote',
  'updateAgent',
  'getRegisterStatus',
  'getRegistrationProgress',
  'waitForRegistrationCompletion',
  'purchaseCreditsWithHbar',
  'purchaseCreditsWithX402',
  'buyCreditsWithX402',
  'createLedgerChallenge',
  'verifyLedgerChallenge',
  'authenticateWithLedger',
  'authenticateWithLedgerCredentials',
  'detectProtocol',
  'setDefaultHeader',
  'chat.start',
  'chat.createSession',
  'chat.sendMessage',
  'chat.endSession',
  'chat.getHistory',
  'chat.compactHistory',
  'chat.getEncryptionStatus',
  'chat.submitEncryptionHandshake',
  'chat.createEncryptedSession',
  'chat.acceptEncryptedSession',
  'chat.startConversation',
  'chat.acceptConversation',
  'conversation.send',
  'conversation.decryptHistoryEntry',
  'conversation.release',
  'encryption.registerKey',
  'encryption.generateEphemeralKeyPair',
  'encryption.deriveSharedSecret',
  'encryption.encryptCipherEnvelope',
  'encryption.decryptCipherEnvelope',
  'encryption.ensureAgentKey',
  'generateEncryptionKeyPair',
  'initializeAgent',
] as const;

export const registryBrokerToolDescription =
  'Use Registry Broker for live agent discovery, counts, chat sessions, registration lifecycle, ledger auth, and encryption. ' +
  'Examples: use `search` with `{ online: true, limit: 5 }` for "Which agents are active right now?", ' +
  '`delegate` with `{ task: "fix the MCP plugin routing bug", context: "TypeScript backend", limit: 3 }` to get broker-native delegation recommendations, ' +
  '`search` with `{ q: "Athena", limit: 10 }` to find agents by name, `stats` for broker totals, ' +
  '`registerAgent` to create a new agent registration, `getRegisterStatus` to verify it is indexed, and `updateAgent` to edit an existing registration.';

export const registryBrokerPayloadDescription =
  'Operation-specific JSON payload. Examples: ' +
  '`search` -> `{ "q": "Athena", "online": true, "limit": 5 }`; ' +
  '`delegate` -> `{ "task": "fix the plugin routing bug", "context": "TypeScript backend", "limit": 3, "filter": { "protocols": ["mcp"], "adapters": ["codex"] } }`; ' +
  '`registerAgent` -> `{ "payload": { "registry": "hashgraph-online", "protocol": "mcp", "endpoint": "https://example.com", "profile": { "display_name": "test-agent" } } }`; ' +
  '`chat.createSession` -> `{ "uaid": "uaid:...", "senderUaid": "principal:ledger:0.0.1234" }`; ' +
  '`chat.sendMessage` -> `{ "sessionId": "...", "message": "READY", "senderUaid": "principal:ledger:0.0.1234" }`; ' +
  '`chat.getHistory` -> `{ "sessionId": "...", "options": { "limit": 5 } }`.';
