import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest', {
      jsc: {
        parser: {
          syntax: 'typescript',
          tsx: false,
          decorators: true
        },
        target: 'es2021'
      },
      module: {
        type: 'es6'
      }
    }]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^file-type$': '<rootDir>/../standards-sdk/__mocks__/file-type.js'
  },
  extensionsToTreatAsEsm: ['.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  verbose: true,
  maxWorkers: 1,
  transformIgnorePatterns: [
    'node_modules/(?!(?:@hashgraphonline|@hashgraph|hedera-agent-kit|@noble)/)'
  ]
};

export default config;
