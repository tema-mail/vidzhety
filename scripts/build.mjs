// Сборка: dist/vidzhety.js (один файл с Preact – для сайтов без Astro и демо), dist/vidzhety.css,
// dist/vidzhety-zhurnal.js (журнал решений, только демо). Печатает размеры в gzip.
// Бюджет 6 КБ gzip – свой код, который грузится сразу на сайте Astro: Preact там уже есть у других островов,
// а окно с формой (src/Dialog.tsx) приходит отдельным куском при первом открытии.
// --demo – копирует сборку в demo/.
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { copyFileSync, readFileSync } from 'node:fs';

const BUDGET_KB = 6;
const base = { bundle: true, minify: true, target: 'es2020', jsx: 'automatic', jsxImportSource: 'preact', legalComments: 'none', charset: 'utf8' };
const iife = (contents, outfile) => build({ ...base, format: 'iife', outfile, stdin: { contents, resolveDir: '.', loader: 'ts' } });

await iife("import { mount } from './src/Widgets.tsx'; mount();", 'dist/vidzhety.js');
await iife("import { attach } from './src/zhurnal.ts'; const l = document.querySelector('[data-w-journal]'); if (l) attach(l);", 'dist/vidzhety-zhurnal.js');
await build({ entryPoints: ['src/vidzhety.css'], bundle: true, minify: true, outfile: 'dist/vidzhety.css' });

// Как модуль ляжет в Astro: ESM с разделением на куски, Preact внешний.
const split = await build({
  ...base, entryPoints: ['src/Widgets.tsx'], format: 'esm', splitting: true, outdir: 'out', write: false, metafile: true,
  external: ['preact', 'preact/*'],
});
const gz = (buf) => gzipSync(buf, { level: 9 }).length / 1024;
const size = Object.fromEntries(split.outputFiles.map((f) => [f.path.slice(f.path.lastIndexOf('/out/') + 1), gz(f.contents)]));
const outs = split.metafile.outputs;
const entry = Object.keys(outs).find((k) => outs[k].entryPoint === 'src/Widgets.tsx');
const first = new Set([entry]);
for (const k of first) for (const i of outs[k].imports) if (i.kind === 'import-statement' && !i.external) first.add(i.path);
const now = [...first].reduce((s, k) => s + size[k], 0);
const lazy = Object.keys(size).filter((k) => !first.has(k) && k.endsWith('.js')).reduce((s, k) => s + size[k], 0);

const f = (n) => n.toFixed(2).padStart(6);
console.log(`dist/vidzhety.js – один файл, с Preact          ${f(gz(readFileSync('dist/vidzhety.js')))} КБ gzip`);
console.log(`в Astro сразу: свой код без Preact             ${f(now)} КБ gzip  (бюджет ${BUDGET_KB} КБ)`);
console.log(`в Astro при первом открытии окна: Dialog       ${f(lazy)} КБ gzip`);
console.log(`dist/vidzhety.css                              ${f(gz(readFileSync('dist/vidzhety.css')))} КБ gzip`);
if (now > BUDGET_KB) {
  console.error(`БЮДЖЕТ ПРЕВЫШЕН: ${now.toFixed(2)} > ${BUDGET_KB} КБ`);
  process.exitCode = 1;
}
if (process.argv.includes('--demo')) {
  for (const n of ['vidzhety.js', 'vidzhety.css', 'vidzhety-zhurnal.js']) copyFileSync('dist/' + n, 'demo/' + n);
  console.log('скопировано в demo/');
}
