// Tiny localhost proxy that sits between the Cloudflare tunnel and Ollama.
//
// Why: the tunnel URL is unauthenticated by default — anyone who learns it
// could hammer the laptop's GPU. This adds a one-line shared-secret check.
// Requests that don't carry the right `x-parser-secret` header get 401 and
// never touch Ollama.
//
// Topology:
//   Railway server  --(https + secret header)-->  cloudflared tunnel
//                                                         |
//                                                         v
//                                          this gatekeeper on 127.0.0.1:11500
//                                                         |
//                                                         v
//                                              Ollama on 127.0.0.1:11434
//
// Usage:
//   PARSER_SECRET=<long-random-string> node server/scripts/ollama-gatekeeper.js
//
// The dev server doesn't go through this — it talks to Ollama directly via
// OLLAMA_URL=http://localhost:11434, no secret needed.

const http = require('http');

const SECRET       = process.env.PARSER_SECRET;
const LISTEN_PORT  = parseInt(process.env.GATEKEEPER_PORT || '11500', 10);
const OLLAMA_HOST  = process.env.OLLAMA_HOST || '127.0.0.1';
const OLLAMA_PORT  = parseInt(process.env.OLLAMA_PORT || '11434', 10);

if (!SECRET || SECRET.length < 16) {
  console.error('[gatekeeper] Refusing to start — PARSER_SECRET must be set and ≥16 chars.');
  process.exit(1);
}

http.createServer((req, res) => {
  if (req.headers['x-parser-secret'] !== SECRET) {
    res.writeHead(401, { 'content-type': 'text/plain' });
    return res.end('unauthorized');
  }

  // Strip the secret on its way to Ollama so it isn't logged downstream.
  const upstreamHeaders = { ...req.headers };
  delete upstreamHeaders['x-parser-secret'];
  upstreamHeaders.host = `${OLLAMA_HOST}:${OLLAMA_PORT}`;

  const upstream = http.request({
    hostname: OLLAMA_HOST,
    port: OLLAMA_PORT,
    path: req.url,
    method: req.method,
    headers: upstreamHeaders,
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`upstream error: ${err.message}`);
  });

  req.pipe(upstream);
}).listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`[gatekeeper] listening 127.0.0.1:${LISTEN_PORT} → ${OLLAMA_HOST}:${OLLAMA_PORT}`);
  console.log(`[gatekeeper] secret length: ${SECRET.length} chars`);
});
