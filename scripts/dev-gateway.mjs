// Local stand-in for the production gateway (deploy/gateway/nginx.conf) when the apps run
// outside Docker (`pnpm dev`, CI): one origin where /api/** (REST and the Socket.IO
// WebSocket) goes to the API and everything else to the web app. Open http://localhost:8080.
//   node scripts/dev-gateway.mjs
// Env: GATEWAY_PORT (8080), API_TARGET (http://127.0.0.1:4000), WEB_TARGET (http://127.0.0.1:3000)
import http from 'node:http';

const port = Number(process.env.GATEWAY_PORT ?? 8080);
const api = new URL(process.env.API_TARGET ?? 'http://127.0.0.1:4000');
const web = new URL(process.env.WEB_TARGET ?? 'http://127.0.0.1:3000');
const targetFor = (url) =>
  url === '/api' || url.startsWith('/api/') || url.startsWith('/api?') ? api : web;

/** Request options for the upstream, keeping Host as the browser sent it (like the gateway). */
const forward = (req, t) => ({
  host: t.hostname,
  port: t.port || 80,
  path: req.url,
  method: req.method,
  headers: {
    ...req.headers,
    'x-forwarded-host': req.headers.host ?? '',
    'x-forwarded-proto': 'http',
    'x-forwarded-for': req.socket.remoteAddress ?? '',
  },
});

const server = http.createServer((req, res) => {
  const up = http.request(forward(req, targetFor(req.url ?? '/')), (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(up);
});

// WebSockets (Socket.IO at /api/socket.io, Next's dev reload elsewhere).
server.on('upgrade', (req, socket, head) => {
  const up = http.request(forward(req, targetFor(req.url ?? '/')));
  up.on('upgrade', (r, upSocket, upHead) => {
    const lines = [`HTTP/1.1 ${r.statusCode} ${r.statusMessage}`];
    for (let i = 0; i < r.rawHeaders.length; i += 2)
      lines.push(`${r.rawHeaders[i]}: ${r.rawHeaders[i + 1]}`);
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    if (upHead.length) socket.write(upHead);
    if (head.length) upSocket.write(head);
    upSocket.pipe(socket).pipe(upSocket);
    socket.on('error', () => upSocket.destroy());
    upSocket.on('error', () => socket.destroy());
  });
  up.on('response', (r) => {
    // Refused upgrade (e.g. a foreign Origin): pass the answer on and close.
    socket.end(`HTTP/1.1 ${r.statusCode} ${r.statusMessage}\r\n\r\n`);
  });
  up.on('error', () => socket.destroy());
  up.end();
});

server.listen(port, () =>
  console.log(`gateway on http://localhost:${port}: /api -> ${api.origin}, rest -> ${web.origin}`),
);
