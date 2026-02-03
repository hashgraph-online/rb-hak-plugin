import baseConfig from './jest.config';

export default {
  ...baseConfig,
  moduleNameMapper: (() => {
    const mapper = { ...(baseConfig as any).moduleNameMapper };
    delete mapper['^@hashgraphonline/standards-sdk$'];
    delete mapper['^file-type$'];
    return mapper;
  })(),
  testPathIgnorePatterns: [],
};
