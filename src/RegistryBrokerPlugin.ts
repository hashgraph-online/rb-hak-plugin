import { Logger } from '@hashgraphonline/standards-sdk';
import type { Context, Plugin, Tool } from 'hedera-agent-kit';
import { RegistryBrokerClientProvider } from './RegistryBrokerClientProvider';
import type { RegistryBrokerPluginConfiguration } from './RegistryBrokerClientProvider';
import { RegistryBrokerConversationStore } from './RegistryBrokerConversationStore';
import {
  RegistryBrokerOperationTool,
  REGISTRY_BROKER_OPERATION_TOOL_NAME,
} from './RegistryBrokerOperationTool';
import type { RegistryBrokerPluginLogger } from './types';

export interface RegistryBrokerPluginOptions {
  configuration?: RegistryBrokerPluginConfiguration;
  logger?: RegistryBrokerPluginLogger;
}

const defaultLogger = Logger.getInstance({ module: 'RegistryBrokerPlugin' });

const createToolInstances = (
  context: Context,
  options: RegistryBrokerPluginOptions,
): Tool[] => {
  void context;
  const handleStore = new RegistryBrokerConversationStore();
  const clientProvider = new RegistryBrokerClientProvider(
    options.configuration,
    options.logger ?? defaultLogger,
  );
  const tool = new RegistryBrokerOperationTool({
    clientProvider,
    handleStore,
  }).toTool();
  return [tool];
};

export const createRegistryBrokerPlugin = (
  options: RegistryBrokerPluginOptions = {},
): Plugin => ({
  name: 'registry-broker-plugin',
  version: '0.1.0',
  description:
    'Expose RegistryBrokerClient operations to Hedera Agent Kit tools for discovery, chat, registration, and ledger auth.',
  tools: (context: Context): Tool[] => createToolInstances(context, options),
});

export const registryBrokerPlugin = createRegistryBrokerPlugin();

export const registryBrokerPluginToolNames = {
  REGISTRY_BROKER_OPERATION_TOOL: REGISTRY_BROKER_OPERATION_TOOL_NAME,
} as const;
