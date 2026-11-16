import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { analyze } from './lib/analyze.mjs';
import { evaluate } from './lib/evaluation.mjs';
import { openStore, RequestError } from './lib/store.mjs';
import { generateLive, providerConfig } from './lib/provider.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const jsonFile = (path) => JSON.parse(readFileSync(path, 'utf8'));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.png': 'image/png' };
const maxBodyBytes = 64 * 1024;

async function readBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw new RequestError(415, 'Send an application/json body.');
  if (Number(request.headers['content-length']) > maxBodyBytes) throw new RequestError(413, 'Request body exceeds 64 KiB.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      request.resume();
      throw new RequestError(413, 'Request body exceeds 64 KiB.');
    }
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError(400, 'Request body must be valid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError(400, 'Request body must be a JSON object.');
  return body;
}

function stringField(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new RequestError(400, `${name} must be a nonempty string of at most ${max} characters.`);
  return value.trim();
}

export function createApp({ dataDir = resolve(root, process.env.DATA_DIR || 'data'), contentDir = resolve(root, 'content'), publicDir = resolve(root, 'public'), provider = providerConfig(), fetchImpl = fetch } = {}) {
  const articles = jsonFile(resolve(contentDir, 'knowledge.json'));
  const examples = jsonFile(resolve(contentDir, 'examples.json'));
  if (!Array.isArray(articles) || !articles.length || !Array.isArray(examples)) throw new Error('Knowledge and examples must contain arrays.');
  mkdirSync(dataDir, { recursive: true });
  const store = openStore(resolve(dataDir, 'relay.sqlite'));
  let liveRequests = 0;
  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000 }, async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    };
    try {
      const port = server.address().port;
      const host = request.headers.host;
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) throw new RequestError(403, 'Unexpected request host. Open the local app URL.');
      if ((request.headers.origin && request.headers.origin !== `http://${host}`)
          || request.headers['sec-fetch-site'] === 'cross-site') throw new RequestError(403, 'Cross-origin requests are not allowed.');
      const pathname = new URL(request.url, `http://${host}`).pathname;
      if (request.method === 'GET' && pathname === '/api/health') return send(200, { ok: true });
      if (request.method === 'GET' && pathname === '/api/bootstrap') return send(200, { articles, examples, modes: { extractive: true, live: Boolean(provider) }, product: 'Harbour' });
      if (request.method === 'GET' && pathname === '/api/history') return send(200, store.history());
      if (request.method === 'GET' && pathname === '/api/evaluation') {
        try { return send(200, evaluate(jsonFile(resolve(contentDir, 'evaluation.json')), articles)); }
        catch { throw new RequestError(500, 'Evaluation could not run. Check the fixed evaluation corpus and server files.'); }
      }
      if (request.method === 'POST' && pathname === '/api/drafts') {
        const body = await readBody(request);
        const ticket = stringField(body.ticket, 'ticket', 4000);
        if (!['en', 'zh'].includes(body.language) || !['extractive', 'live'].includes(body.mode)) throw new RequestError(400, 'Choose language en or zh and mode extractive or live.');
        const started = performance.now();
        let output = { ...analyze(ticket, body.language, articles), providerUsed: false };
        if (body.mode === 'live') {
          if (liveRequests >= 2) throw new RequestError(429, 'Two model requests are already running. Wait and retry.');
          liveRequests++;
          try { output = await generateLive(ticket, body.language, output, provider, fetchImpl); }
          finally { liveRequests--; }
        }
        const draft = store.saveDraft({ id: randomUUID(), ticket, language: body.language, mode: body.mode,
          ...output, createdAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started) });
        return send(201, { draft });
      }
      if (request.method === 'POST' && pathname === '/api/handoffs') {
        const body = await readBody(request);
        if (body.approved !== true) throw new RequestError(400, 'Explicit review approval is required before delivery.');
        const draftId = stringField(body.draftId, 'draftId', 100);
        const reply = stringField(body.reply, 'reply', 8000);
        if (body.simulateFailure !== undefined && typeof body.simulateFailure !== 'boolean') throw new RequestError(400, 'simulateFailure must be a boolean.');
        return send(200, { handoff: store.deliver({ draftId, reply, simulateFailure: body.simulateFailure }) });
      }
      if (pathname.startsWith('/api/')) throw new RequestError(404, 'API route not found.');
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new RequestError(405, 'Method not allowed.');
      let decoded;
      try { decoded = decodeURIComponent(pathname); } catch { throw new RequestError(400, 'Invalid request path.'); }
      const path = resolve(publicDir, `.${decoded === '/' ? '/index.html' : decoded}`);
      if (!path.startsWith(`${resolve(publicDir)}${sep}`) || !types[extname(path)]) throw new RequestError(404, 'File not found.');
      let bytes;
      try { bytes = await readFile(path); } catch { throw new RequestError(404, 'File not found.'); }
      response.writeHead(200, { 'Content-Type': types[extname(path)] });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) send(error instanceof RequestError ? error.status : 500,
        { error: error instanceof RequestError ? error.message : 'The local server could not complete the request.' });
    }
  });
  server.on('close', () => store.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const server = createApp();
  server.listen(port, '127.0.0.1', () => process.stdout.write(`Relay Desk: http://127.0.0.1:${port}\n`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
