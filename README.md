# Registry Broker Plugin for Hedera Agent Kit

| ![](./Hashgraph-Online.png) | `@hol-org/rb-hak-plugin` brings the [Hashgraph Online Registry Broker](https://hol.org/registry) directly into Hedera Agent Kit so agents can discover, chat with, and register peers from within workflows.<br><br>Built and maintained by [Hashgraph Online](https://hashgraphonline.com).<br><br>[📚 Registry Broker Quickstart](https://hol.org/registry/docs#getting-started/quick-start.md) · [📦 Standards SDK](https://hashgraphonline.com/docs/libraries/standards-sdk/) |
| :-------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

## Features

- Full coverage of the Registry Broker REST API (search, registration lifecycle, ledger auth, encryption helpers).
- Seamless conversation handle management so agents can continue chats (encrypted or plaintext) without re-fetching handles.
- Reuses the Hedera Agent Kit `Client` operator (ledger-auth only) and falls back to API keys when necessary.
- Live integration test + Hedera Agent Kit demo that hit the production Registry Broker (no mocks).
- Matches the [Registry Broker Quickstart](https://hol.org/registry/docs#getting-started/quick-start.md) so every HTTP capability is exposed to agents.

## Installation

```bash
pnpm add @hol-org/rb-hak-plugin hedera-agent-kit
```

## Quickstart

```ts
import { HederaLangchainToolkit, AgentMode } from 'hedera-agent-kit';
import {
  createRegistryBrokerPlugin,
  registryBrokerPluginToolNames,
} from '@hol-org/rb-hak-plugin';

const toolkit = new HederaLangchainToolkit({
  client,
  configuration: {
    plugins: [createRegistryBrokerPlugin()],
    tools: [registryBrokerPluginToolNames.REGISTRY_BROKER_OPERATION_TOOL],
    context: { mode: AgentMode.AUTONOMOUS },
  },
});

const registryTool = toolkit.getTools().find(
  tool => tool.name === registryBrokerPluginToolNames.REGISTRY_BROKER_OPERATION_TOOL,
);
```

The tool now exposes a fixed operation enum, so the agent can see the supported Registry Broker actions instead of guessing from a generic `string` field.

## Common Operations

```ts
await registryTool.invoke({
  operation: 'search',
  payload: { online: true, limit: 5 },
});

await registryTool.invoke({
  operation: 'search',
  payload: { q: 'Athena', limit: 10 },
});

await registryTool.invoke({
  operation: 'stats',
});

await registryTool.invoke({
  operation: 'delegate',
  payload: {
    task: 'Fix the MCP plugin routing bug.',
    context: 'TypeScript backend integration',
    limit: 3,
    filter: {
      protocols: ['mcp'],
      adapters: ['codex'],
    },
  },
});

await registryTool.invoke({
  operation: 'registerAgent',
  payload: {
    payload: {
      registry: 'hashgraph-online',
      protocol: 'mcp',
      endpoint: 'https://example.com/mcp',
      profile: {
        display_name: 'test-agent',
      },
    },
  },
});
```

Natural-language prompts such as "Which agents are active right now?" or "Who should I delegate this TypeScript broker fix to?" only work when your agent runtime is allowed to call `registry_broker_operation`. Asking an arbitrary remote agent those questions will not query the broker unless that runtime explicitly routes the request through this tool.

## Environment

Use the same Hedera operator credentials you already provide to Hedera Agent Kit (`client.setOperator(...)` or env vars such as `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY`, or `ACCOUNT_ID` as the account id). The plugin inspects the `Client` you pass to Hedera Agent Kit and reuses its operator + signer for Registry Broker ledger authentication—no duplicate `REGISTRY_BROKER_LEDGER_*` secrets are required.

Optional:

- `HEDERA_NETWORK` (defaults to `hedera:testnet`; set `hedera:mainnet` to force mainnet).
- `REGISTRY_BROKER_API_KEY` for API-key-only flows.
- `REGISTRY_BROKER_DEMO_UAID` to override the default OpenRouter UAID used by the demo.

If you rely on `.env` to set those values locally, create it inside this repo (never reference secrets from sibling projects).

## Commands

```bash
pnpm run lint       # ESLint over src
pnpm run typecheck  # tsc --noEmit
pnpm test           # unit + live integration test
pnpm demo:hedera-kit # run the Langchain demo script
pnpm run release    # install, build, and publish with pnpm
```

## Hedera Agent Kit Demo

Run the end-to-end demo to see the plugin registered with a real Hedera Agent Kit (`HederaLangchainToolkit`) instance. The script:

1. Loads the Registry Broker plugin into Hedera Agent Kit using the same operator account that powers your toolkit client.
2. Runs a live active-agent search against the Registry Broker.
3. Requests a broker-native delegation recommendation for a plugin/backend task.
4. Starts a chat session with a UAID, sends a capability prompt using the toolkit operator as `senderUaid`, fetches history, and closes the session.

```bash
pnpm demo:hedera-kit
```

Required environment: `HEDERA_OPERATOR_ID` (or `ACCOUNT_ID`) + `HEDERA_OPERATOR_KEY` (or equivalent `MAINNET_*` variables) so Hedera Agent Kit can set its operator. Set `REGISTRY_BROKER_DEMO_UAID` only if you want to test your own UAID; otherwise the script falls back to the bundled OpenRouter agent.

## Docs & Resources

- [Registry Broker Quickstart](https://hol.org/registry/docs#getting-started/quick-start.md)
- [Hashgraph Online Standards SDK](https://hashgraphonline.com/docs/libraries/standards-sdk/)
- [Hedera Agent Kit](https://github.com/hashgraph/hedera-agent-kit-js)
