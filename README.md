# Registry Broker Plugin for Hedera Agent Kit

This package exposes the [Hashgraph Online Registry Broker](https://registry.hashgraphonline.com) via a Hedera Agent Kit plugin so agents can discover, chat, and register peers directly from workflows. It wraps the `RegistryBrokerClient` from `@hashgraphonline/standards-sdk` inside a Hedera-compatible plugin and tool surface.

## Features

- Full coverage of the Registry Broker REST API, including search, registration lifecycle, credit purchases, ledger authentication, and encryption utilities.
- Conversation handle management so agents can start chats, continue encrypted sessions, and decrypt history without re-fetching handles.
- Configurable authentication: API keys, ledger credentials, or runtime env detection.
- Production integration test that exercises live search + chat flows against the broker (requires valid credentials).

## Getting Started

```bash
pnpm install
pnpm run build
```

### Environment

Create a local `.env` (or export variables in your shell) with the same credentials you already use to configure your Hedera Agent Kit client. The plugin inspects the `Client` instance you pass to Hedera Agent Kit and reuses its operator account + signer for registry-broker ledger authentication, so there are no duplicate `REGISTRY_BROKER_LEDGER_*` secrets to manage. If you instantiate the Hedera SDK client manually, continue calling `client.setOperator(...)` as usual and the plugin will derive the signer automatically.

Minimum environment variables (only needed when you rely on `.env` to build the Hedera client locally):

- `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY` (or `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` as fallbacks)
- Optional: `HEDERA_NETWORK` (`hedera:testnet` by default, `hedera:mainnet` when set)
- Optional: `MAINNET_HEDERA_ACCOUNT_ID` / `MAINNET_HEDERA_PRIVATE_KEY` to force mainnet without flipping `HEDERA_NETWORK`
- Optional: `OPENROUTER_API_KEY` or paid UAIDs for demos that interact with paid registries

API keys such as `REGISTRY_BROKER_API_KEY` remain supported for non-ledger flows, and the legacy environment-based ledger auth remains available as a fallback when a Hedera client operator is not configured.

### Testing

Unit tests mock the broker SDK, while the integration test hits the live Hashgraph Online Registry:

```bash
pnpm test              # runs unit + integration suites
pnpm test __tests__/registry-broker-plugin.integration.test.ts
```

Set `JEST_REAL_FETCH=true` when you want to bypass the OpenRouter model stub. The integration test handles this automatically.

### Linting & Types

```bash
pnpm run lint
pnpm run typecheck
```

### Usage

```ts
import { AgentMode, HederaLangchainToolkit } from 'hedera-agent-kit';
import {
  createRegistryBrokerPlugin,
  registryBrokerPluginToolNames,
} from '@hashgraphonline/registry-broker-plugin';

const registryBrokerPlugin = createRegistryBrokerPlugin();
const toolkit = new HederaLangchainToolkit({
  client,
  configuration: {
    plugins: [registryBrokerPlugin],
    tools: [registryBrokerPluginToolNames.REGISTRY_BROKER_OPERATION_TOOL],
    context: { mode: AgentMode.AUTONOMOUS },
  },
});

const tools = toolkit.getTools();
```

Pass `configuration` overrides into `createRegistryBrokerPlugin({ configuration: { client: { ... }, ledger: { ... } } })` to customize API keys or provide explicit ledger credentials when you do not want to rely on the shared Hedera env vars.

### Hedera Agent Kit Demo

Run the end-to-end demo to see the plugin registered with a real Hedera Agent Kit (`HederaLangchainToolkit`) instance. The script:

1. Loads the Registry Broker plugin into Hedera Agent Kit using the same operator account that powers your toolkit client.
2. Runs a live search against the Registry Broker.
3. Starts a chat session with a UAID, sends a message, fetches history, and closes the session.

```bash
pnpm demo:hedera-kit
```

The following environment variables must be available (configure them in your shell or local `.env` file before running the demo):

- `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY` or `MAINNET_HEDERA_ACCOUNT_ID` / `MAINNET_HEDERA_PRIVATE_KEY`
- `HEDERA_NETWORK` (optional, defaults to `hedera:testnet`)
- `REGISTRY_BROKER_DEMO_PAID_UAID` or `REGISTRY_BROKER_DEMO_A2A_UAID` (optional – the script automatically cycles through the provided UAIDs and finally falls back to the bundled OpenRouter UAID until one succeeds)

The script logs each stage so you can verify the broker responses end-to-end.
