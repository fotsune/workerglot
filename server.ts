import { createServer } from 'node:http';
import { envFromProcess } from './config.js';
import worker from './worker.js';

// Node has no automatic .env loading; read it when present, silently if there is none.
try {
  process.loadEnvFile?.('.env');
} catch {
  // no .env file - plain environment variables are enough
}

const env = envFromProcess();
const port = env.PORT ? Number(env.PORT) : 3220;

const server = createServer(async (req, res) => {
  try {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);

    const request = new Request(`http://${headers.host ?? `localhost:${port}`}${req.url ?? '/'}`, {
      method: req.method ?? 'GET',
      headers,
      body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
    });

    const response = await worker.fetch(request, env);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    res.writeHead(response.status, responseHeaders);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('Request failed:', error);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(port, () => {
  console.log(`Polyglot listening on http://localhost:${port}`);
});
