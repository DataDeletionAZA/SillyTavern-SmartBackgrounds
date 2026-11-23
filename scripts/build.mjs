import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { RESTORATION_MODELS } from '../src/core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const models = path.join(root, 'models');
const runtime = path.join(root, 'runtime');
const bundlePath = path.join(dist, 'index.js');

await Promise.all(Object.values(RESTORATION_MODELS).map(model => fs.access(path.join(models, model.filename))));

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });
await fs.rm(runtime, { recursive: true, force: true });

await build({
    entryPoints: [path.join(root, 'src/index.js')],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    sourcemap: false,
    legalComments: 'eof',
    external: ['/script.js', '/scripts/*'],
    logLevel: 'info',
});

const bundle = await fs.readFile(bundlePath, 'utf8');
const normalizedBundle = bundle.replace(/[ \t]+$/gm, '').replace(/\n+$/u, '\n');
await fs.writeFile(bundlePath, normalizedBundle);

await fs.mkdir(runtime, { recursive: true });
for (const filename of [
    'ort-wasm-simd-threaded.asyncify.mjs',
    'ort-wasm-simd-threaded.asyncify.wasm',
]) {
    await fs.copyFile(
        path.join(root, 'node_modules', 'onnxruntime-web', 'dist', filename),
        path.join(runtime, filename),
    );
}

console.log('Smart Backgrounds build complete.');
