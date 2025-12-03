import type { ILogger } from '@hashgraphonline/standards-sdk';

export type RegistryBrokerPluginLogger = Pick<
  ILogger,
  'info' | 'warn' | 'error' | 'debug'
>;
