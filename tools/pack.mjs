#!/usr/bin/env node
/**
 * 打包成 dist/bilibili-bv-copier-<version>.zip（只放扩展运行需要的文件）。
 *
 *   node tools/pack.mjs
 *
 * 用 Node 自带的 zlib 手写 zip 容器，不依赖 7z / zip / Compress-Archive，
 * 所以换台机器、换个 shell 都能同样跑。
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './lib/zip.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const version = manifest.version;
const distDir = join(ROOT, 'dist');
const target = join(distDir, `bilibili-bv-copier-${version}.zip`);

const INCLUDE = ['manifest.json', '_locales', 'src', 'icons'];

function walk(absPath, out = []) {
  for (const entry of readdirSync(absPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(absPath, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const files = [];
for (const name of INCLUDE) {
  const from = join(ROOT, name);
  const stat = statSync(from, { throwIfNoEntry: false });
  if (!stat) throw new Error(`缺少 ${name}（应在 ${ROOT}）`);
  const targets = stat.isFile() ? [from] : walk(from);
  for (const abs of targets) {
    files.push({ name: relative(ROOT, abs).split(sep).join('/'), data: readFileSync(abs) });
  }
}

files.sort((a, b) => (a.name < b.name ? -1 : 1));
mkdirSync(distDir, { recursive: true });
writeFileSync(target, createZip(files));

const bytes = files.reduce((sum, f) => sum + f.data.length, 0);
console.log(`已打包：${target}`);
console.log(`版本 ${version}：${files.length} 个文件，原始 ${(bytes / 1024).toFixed(1)} KB → 压缩后 ${(readFileSync(target).length / 1024).toFixed(1)} KB`);
console.log('解压后目录里就是 manifest.json / _locales / src / icons，可直接在扩展管理页「加载已解压的扩展程序」。');
