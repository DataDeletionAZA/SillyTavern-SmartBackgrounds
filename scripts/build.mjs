import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const models = path.join(root, 'models');
const bundlePath = path.join(dist, 'index.js');

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });
await fs.rm(models, { recursive: true, force: true });

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

for (const scale of [2, 3, 4]) {
    const source = path.join(root, 'node_modules', '@upscalerjs', 'esrgan-slim', 'models', `x${scale}`);
    const destination = path.join(models, `x${scale}`);
    await fs.cp(source, destination, { recursive: true });
}

console.log('Smart Backgrounds build complete.');
