# Registry Broker Plugin for Hedera Agent Kit

This package exposes the [Hashgraph Online Registry Broker](https://hol.org/registry) via a Hedera Agent Kit plugin so agents can discover, chat, and register peers directly from workflows. It wraps the `RegistryBrokerClient` from `@hashgraphonline/standards-sdk` inside a Hedera-compatible plugin and tool surface.

## Features

- Full coverage of the Registry Broker REST API, including search, registration lifecycle, credit purchases, ledger authentication, and encryption utilities.
- Conversation handle management so agents can start chats, continue encrypted sessions, and decrypt history without re-fetching handles.
- Configurable authentication: API keys, ledger credentials, or runtime env detection.
- Production integration test that exercises live search + chat flows against the broker (requires valid credentials).
- Built on the official [Registry Broker docs](https://hol.org/registry/docs#getting-started/quick-start.md), so anything you can do via the HTTP client is now available inside Hedera Agent Kit tools.

## Getting Started

```bash
pnpm install
pnpm run build
```

### Environment

No special secrets are required for the plugin itself—whatever operator you already configure on the Hedera SDK `Client` will be reused for Registry Broker ledger auth. Just keep doing what you do for Hedera Agent Kit (e.g. `client.setOperator(...)` or `HEDERA_OPERATOR_ID/HEDERA_OPERATOR_KEY` in `.env`).

Optional extras:

- `HEDERA_NETWORK` to force `hedera:mainnet` or `hedera:testnet` (defaults to testnet).
- `MAINNET_HEDERA_ACCOUNT_ID` / `MAINNET_HEDERA_PRIVATE_KEY` if you prefer separate creds for mainnet automation.
- `OPENROUTER_API_KEY` only when you want the demo to use a paid OpenRouter model.

`REGISTRY_BROKER_API_KEY` is still respected for non-ledger flows, but you rarely need it because the operator signer handles paid access automatically.

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
- Optional: `REGISTRY_BROKER_DEMO_PAID_UAID` or `REGISTRY_BROKER_DEMO_A2A_UAID` if you want to force the demo to chat with your own UAID; by default it uses the bundled OpenRouter agent so no extra setup is required.

The script logs each stage so you can verify the broker responses end-to-end.
