import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const port = Number(process.argv[3] ?? 8099);
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
http
  .createServer((req, res) => {
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
