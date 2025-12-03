import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

type FetchArgs = Parameters<typeof fetch>;

const loadEnvIfExists = (envPath: string): void => {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
};

loadEnvIfExists(path.resolve(process.cwd(), '.env'));
loadEnvIfExists(path.resolve(process.cwd(), '.env.local'));

const realFetch = global.fetch.bind(global);

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const fetchStub = async (...args: FetchArgs): Promise<Response> => {
  const [input, init] = args;
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : '';
  if (process.env.JEST_REAL_FETCH === 'true') {
    return realFetch(input, init);
  }
  if (
    target.includes('openrouter.ai/api/v1/models') ||
    target.includes('openrouter.ai/models')
  ) {
    return jsonResponse({
      data: [
        {
          id: 'anthropic/claude-3.5-sonnet',
          name: 'Anthropic Claude 3.5 Sonnet',
          description: 'Anthropic Claude 3.5 Sonnet',
          context_length: 200000,
          pricing: { prompt: '0.0', completion: '0.0' },
        },
        {
          id: 'openai/gpt-4o-mini',
          name: 'OpenAI GPT-4o Mini',
          description: 'OpenAI GPT-4o Mini',
          context_length: 128000,
          pricing: { prompt: '0.0', completion: '0.0' },
        },
      ],
    });
  }
  return jsonResponse({ data: [] });
};

const applyFetchStub = (): void => {
  if (typeof global.fetch === 'function' && 'mockImplementation' in global.fetch) {
    (global.fetch as jest.Mock).mockImplementation(fetchStub);
    return;
  }
  global.fetch = jest.fn(fetchStub) as typeof fetch;
};

applyFetchStub();

beforeEach(() => {
  jest.restoreAllMocks();
  applyFetchStub();
});
