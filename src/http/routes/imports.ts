import { Hono } from 'hono';
import { importMemories, importFromNDJSON, importFromCSV, type ImportRecord } from '../../core/imports.js';
import { logger } from '../../logger.js';

export function mountImports(app: Hono): void {
  app.post('/api/imports', async c => {
    try {
      const body = await c.req.json<{
        records?: ImportRecord[];
        format?: 'json' | 'ndjson' | 'csv';
        data?: string;
      }>();

      if (body.records && Array.isArray(body.records)) {
        // Direct JSON records
        const result = await importMemories(body.records);
        logger.info(result, 'bulk import via JSON');
        return c.json(result);
      }

      if (body.data && body.format) {
        // Format conversion
        let result;
        if (body.format === 'ndjson') {
          result = await importFromNDJSON(body.data);
        } else if (body.format === 'csv') {
          result = await importFromCSV(body.data);
        } else {
          throw new Error(`Unsupported format: ${body.format}`);
        }
        logger.info(result, `bulk import via ${body.format}`);
        return c.json(result);
      }

      throw new Error('Either records array or (data + format) required');
    } catch (err) {
      logger.error({ err }, 'import failed');
      throw err;
    }
  });

  app.get('/api/imports/sample', c => {
    const samples = {
      json: [
        {
          content: 'Example fact about memory system architecture',
          type: 'fact',
          project: 'aibrain',
          importance: 4,
          tags: ['architecture', 'core'],
        },
        {
          content: 'Decision to use cosine similarity threshold of 0.82',
          type: 'decision',
          project: 'aibrain',
        },
      ],
      ndjson: `{"content":"Fact 1","type":"fact","project":"aibrain"}
{"content":"Fact 2","type":"fact","project":"aibrain","importance":4}`,
      csv: `content,type,project,importance
"Example fact",fact,aibrain,4
"Another fact",fact,aibrain,3`,
    };
    return c.json(samples);
  });
}
