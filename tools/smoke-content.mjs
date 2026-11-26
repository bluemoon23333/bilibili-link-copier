/**
 * 冒烟：B 站视频页右下角的「复制链接」浮动按钮。
 *
 * 断言：视频页出现按钮 → 点一下 → 提示「已复制」→ 剪贴板里是第 1 条线路拼出来的链接；
 *       非视频页（首页）不出现按钮。
 */
import { fileURLToPath } from 'node:url';
import { launchBrowser, openTab, sleep, waitFor } from './lib/browser.mjs';

const EXT_DIR = fileURLToPath(new URL('..', import.meta.url));
const VIDEO_URL = process.env.SMOKE_VIDEO || 'https://www.bilibili.com/video/BV1AM4y1M71p';
const HOME_URL = 'https://www.bilibili.com/';

const results = [];
let exitCode = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) exitCode = 1;
}

const browser = await launchBrowser({ extDir: EXT_DIR, headless: true });
console.log(`浏览器：${browser.browserPath}\n`);
try {
  const { cdp } = await openTab(browser.port, VIDEO_URL);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // 剪贴板读取权限：给页面授权后才读得回来
  await cdp.send('Browser.grantPermissions', {
    origin: 'https://www.bilibili.com',
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  }).catch(() => {});

  const appeared = await waitFor(
    () => cdp.eval(`Boolean(document.getElementById('bili-copy-float'))`),
    { timeout: 25000, interval: 300, what: '浮动按钮出现' },
  ).catch(() => false);
  check('视频页出现「复制链接」浮动按钮', appeared === true);

  const label = appeared ? await cdp.eval(`document.getElementById('bili-copy-float').innerText`) : '';
  check('按钮文案是「复制链接」', /复制链接/.test(label), label);
  check(
    '按钮固定在右下角且不影响播放器',
    appeared &&
      (await cdp.eval(`(() => {
        const s = getComputedStyle(document.getElementById('bili-copy-float'));
        return s.position === 'fixed' && parseFloat(s.right) < 40 && parseFloat(s.bottom) > 10;
      })()`)),
  );

  if (appeared) {
    await cdp.eval(`document.getElementById('bili-copy-float').click()`);
    const toast = await waitFor(
      () => cdp.eval(`(() => { const t = document.getElementById('bili-copy-float-toast'); return t && t.classList.contains('show') ? t.textContent : ''; })()`),
      { timeout: 8000, interval: 150, what: '复制提示' },
    ).catch(() => '');
    check('点一下给出「已复制」提示', /已复制/.test(toast), toast);

    const clipboard = await cdp
      .eval(`navigator.clipboard.readText().catch((e) => 'ERR ' + e.message)`)
      .catch((e) => `ERR ${e.message}`);
    check(
      '剪贴板里是第 1 条线路拼出来的链接',
      typeof clipboard === 'string' && clipboard.startsWith('https://api.xuan25.com/bili-resolve/BV1AM4y1M71p'),
      String(clipboard).slice(0, 90),
    );
  }

  // 首页不该出现按钮
  const home = await openTab(browser.port, HOME_URL);
  await home.cdp.send('Page.enable');
  await sleep(2500);
  const onHome = await home.cdp.eval(`Boolean(document.getElementById('bili-copy-float'))`).catch(() => true);
  check('首页不出现按钮', onHome === false);

  const errors = [];
  console.log(`\n共 ${results.length} 项，通过 ${results.filter((r) => r.ok).length} 项${exitCode ? '，有失败' : ''}`);
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  browser.kill();
}
process.exit(exitCode);
