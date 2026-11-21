// Copies the background-blur runtime (MediaPipe tasks-vision WebAssembly) into public/vision so
// calls load it from this server instead of a CDN. The segmentation model is committed there.
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const processors = realpathSync(
  dirname(require.resolve('@livekit/track-processors', { paths: [join(here, '..')] })),
);
let dir = processors;
let wasm = null;
while (dir !== dirname(dir)) {
  const candidate = join(dir, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
  if (existsSync(candidate)) {
    wasm = candidate;
    break;
  }
  dir = dirname(dir);
}
if (!wasm) throw new Error('@mediapipe/tasks-vision not found; run pnpm install');
const out = join(here, '..', 'public', 'vision');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(wasm)) cpSync(join(wasm, f), join(out, f));
console.log(`background blur runtime copied to ${out}`);
