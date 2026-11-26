#!/usr/bin/env node
/**
 * 生成上架商店用的截图（1280×800，Edge / Chrome 商店都收这个尺寸）。
 *
 *   node tools/shot-store.mjs
 *
 * 产出：
 *   store/screenshots/01-options.png   设置页上半部分（线路列表 / 预览）
 *   store/screenshots/02-speedtest.png 测速面板（真跑一轮快速档）
 *   store/screenshots/03-button.png    B 站视频页右下角的复制按钮
 *
 * 和 smoke 脚本一样把扩展复制到临时目录，并把可选权限改成安装即授权，
 * 这样无头浏览器点得了「开始测速」，不用弹系统授权框。
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extensionIdFromPrefs,
  launchBrowser,
  openOptionsPage,
  openTab,
  sleep,
  waitExtensionId,
  waitFor,
} from './lib/browser.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(HERE, '..');
const OUT_DIR = resolve(EXT_DIR, 'store', 'screenshots');
const W = 1280;
const H = 800;
const VIDEO_URL = process.env.SMOKE_VIDEO || 'https://www.bilibili.com/video/BV1AM4y1M71p';

const workDir = mkdtempSync(join(tmpdir(), 'bvc-store-'));
const extCopy = join(workDir, 'ext');
const SKIP = new Set(['dist', 'node_modules', '.git', 'docs', 'store']);
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

mkdirSync(OUT_DIR, { recursive: true });

/** 统一按 1280×800 输出（只截视口，不拉全页）。 */
async function sizeViewport(cdp) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function saveShot(cdp, name) {
  await sleep(500);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = join(OUT_DIR, name);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`已保存 ${file}`);
}

const browser = await launchBrowser({ extDir: extCopy, extraArgs: [`--window-size=${W},${H}`] });
let exitCode = 0;
try {
  const extId = await waitExtensionId(browser.port).catch(() => extensionIdFromPrefs(browser.profileDir, extCopy));
  if (!extId) throw new Error('扩展加载失败');

  // ① 设置页上半部分
  const page = await openOptionsPage(browser.port, extId);
  const cdp = page.cdp;
  await sizeViewport(cdp);
  await waitFor(() => cdp.eval(`document.querySelectorAll('#list .entry').length > 0`), { what: '设置页渲染' });
  await sleep(600);
  await saveShot(cdp, '01-options.png');

  // ② 测速面板：跑一轮快速档，再滚到测速区块
  await cdp.eval(`(() => {
    const sel = document.querySelector('#speed-depth');
    sel.value = 'quick';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#speed-run').click();
    return true;
  })()`);
  await waitFor(
    () =>
      cdp.eval(`(() => {
        const rows = [...document.querySelectorAll('#speed-result tbody tr')].filter((r) => !r.classList.contains('detail'));
        const status = (document.querySelector('#speed-status')?.textContent || '').trim();
        return rows.length >= 2 && /测速完成|测速失败|已停止/.test(status);
      })()`),
    { timeout: 90000, interval: 400, what: '测速跑完' },
  );
  await cdp.eval(`(() => {
    const box = document.querySelector('#speed');
    const y = box.getBoundingClientRect().top + window.scrollY - 8;
    window.scrollTo(0, y);
    return y;
  })()`);
  await saveShot(cdp, '02-speedtest.png');

  // ③ B 站视频页的浮动按钮
  const { cdp: pageCdp } = await openTab(browser.port, VIDEO_URL);
  await pageCdp.send('Page.enable');
  await sizeViewport(pageCdp);
  await waitFor(() => pageCdp.eval(`Boolean(document.getElementById('bili-copy-float'))`), {
    timeout: 30000,
    interval: 300,
    what: '浮动按钮出现',
  });
  await sleep(2200);
  await saveShot(pageCdp, '03-button.png');
} catch (err) {
  console.error(`截图失败：${err.message}`);
  exitCode = 1;
} finally {
  await browser.kill();
  rmSync(workDir, { recursive: true, force: true });
}

process.exit(exitCode);
