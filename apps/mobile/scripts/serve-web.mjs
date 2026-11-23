import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const port = Number(process.argv[3] ?? 8099);
// The API lives under /api on the same address as the app (issue #128). Forward /api/** (and
// its WebSocket) to a locally running API, as the gateway does in production.
const api = new URL(process.env.API_PROXY ?? 'http://localhost:4000');
const forward = (req) => ({
  host: api.hostname,
  port: api.port || 80,
  path: req.url,
  method: req.method,
  headers: { ...req.headers, host: req.headers.host, 'x-forwarded-host': req.headers.host },
});
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};
const server = http
  .createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      const up = http.request(forward(req), (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on('error', () => (res.writeHead(502), res.end()));
      req.pipe(up);
      return;
    }
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.join(root, u);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      const html = path.join(root, u.replace(/\/$/, '') + '.html');
      f = fs.existsSync(html) ? html : path.join(root, 'index.html');
    }
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Type', types[path.extname(f)] ?? 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  })
  .listen(port, () => console.log('serving', port));
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/api/')) return socket.destroy();
  const up = http.request(forward(req));
  up.on('upgrade', (r, upSocket, upHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(r.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n')}\r\n\r\n`,
    );
    if (upHead.length) socket.write(upHead);
    if (head.length) upSocket.write(head);
    upSocket.pipe(socket).pipe(upSocket);
  });
  up.on('error', () => socket.destroy());
  up.end();
});
