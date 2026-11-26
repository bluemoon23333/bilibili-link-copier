#!/usr/bin/env node
/**
 * 跑一轮真实测速，并把结果表截成 PNG（给 README / 交付说明用）。
 *
 *   node tools/shot-speedtest.mjs                 # normal 档，输出 docs/speedtest.png
 *   node tools/shot-speedtest.mjs deep docs/x.png # 指定档位与输出路径
 *
 * 和 smoke-speedtest 一样：把扩展复制到临时目录、把可选权限改成安装即授权，
 * 这样无头浏览器不用点系统授权框。
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extensionIdFromPrefs, launchBrowser, openOptionsPage, sleep, waitExtensionId, waitFor } from './lib/browser.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(HERE, '..');
const DEPTH = process.argv[2] || 'normal';
const OUT = resolve(EXT_DIR, process.argv[3] || 'docs/speedtest.png');

const workDir = mkdtempSync(join(tmpdir(), 'bvc-shot-'));
const extCopy = join(workDir, 'ext');
const SKIP = new Set(['dist', 'node_modules', '.git', 'docs']);
cpSync(EXT_DIR, extCopy, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(EXT_DIR.length).replace(/^[\\/]+/, '');
    const top = rel.split(/[\\/]/)[0];
    return !SKIP.has(top);
  },
});
const manifest = JSON.parse(readFileSync(join(extCopy, 'manifest.json'), 'utf8'));
delete manifest.optional_host_permissions;
manifest.host_permissions = ['<all_urls>'];
writeFileSync(join(extCopy, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

const browser = await launchBrowser({ extDir: extCopy, extraArgs: ['--window-size=1040,1200'] });
let cdp = null;
let exitCode = 0;
try {
  const extId = await waitExtensionId(browser.port).catch(() => extensionIdFromPrefs(browser.profileDir, extCopy));
  if (!extId) throw new Error('扩展加载失败');

  const page = await openOptionsPage(browser.port, extId);
  cdp = page.cdp;
  await waitFor(() => cdp.eval(`document.querySelectorAll('#list .entry').length > 0`), { what: '设置页渲染' });

  await cdp.eval(`(() => {
    const sel = document.querySelector('#speed-depth');
    sel.value = ${JSON.stringify(DEPTH)};
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#speed-run').click();
    return true;
  })()`);

  await waitFor(
    () =>
      cdp.eval(`(() => {
        const rows = [...document.querySelectorAll('#speed-result tbody tr')].filter((r) => !r.classList.contains('detail'));
        const status = (document.querySelector('#speed-status')?.textContent || '').trim();
        return rows.length >= 3 && /测速完成|测速失败|已停止/.test(status);
      })()`),
    { timeout: 120000, interval: 500, what: '测速跑完' },
  );

  const status = await cdp.eval(`(document.querySelector('#speed-status')?.textContent || '').trim()`);
  console.log(`状态：${status}`);

  await sleep(400);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log(`截图已保存：${OUT}`);
} catch (err) {
  console.error(`截图失败：${err.message}`);
  exitCode = 1;
} finally {
  if (cdp) cdp.close();
  await browser.kill();
  rmSync(workDir, { recursive: true, force: true });
}

process.exit(exitCode);
