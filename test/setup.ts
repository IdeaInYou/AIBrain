// config.ts validates env at import time; give it a valid one for unit tests.
process.env.MCP_AUTH_TOKEN ??= 'test-token';
process.env.MCP_TRANSPORT ??= 'http';
process.env.OPENSEARCH_URL ??= 'http://localhost:9200';
process.env.LOG_LEVEL ??= 'silent';
