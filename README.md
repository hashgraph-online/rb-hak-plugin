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

## Environment

Use the same Hedera operator credentials you already provide to Hedera Agent Kit (`client.setOperator(...)` or env vars such as `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY`). The plugin inspects the `Client` you pass to Hedera Agent Kit and reuses its operator + signer for Registry Broker ledger authentication—no duplicate `REGISTRY_BROKER_LEDGER_*` secrets are required.

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
2. Runs a live search against the Registry Broker.
3. Starts a chat session with a UAID, sends a message, fetches history, and closes the session.

```bash
pnpm demo:hedera-kit
```

Required environment: `HEDERA_OPERATOR_ID` + `HEDERA_OPERATOR_KEY` (or equivalent `MAINNET_*` variables) so Hedera Agent Kit can set its operator. Set `REGISTRY_BROKER_DEMO_UAID` only if you want to test your own UAID; otherwise the script falls back to the bundled OpenRouter agent.

## Docs & Resources

- [Registry Broker Quickstart](https://hol.org/registry/docs#getting-started/quick-start.md)
- [Hashgraph Online Standards SDK](https://hashgraphonline.com/docs/libraries/standards-sdk/)
- [Hedera Agent Kit](https://github.com/hashgraph/hedera-agent-kit-js)
