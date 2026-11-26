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

  if (appeared) {
    // 双击：450 ms 内点两下 = 第 2 条（默认空前缀 → 裸 BV 号）
    // 离屏文档刚被回收时第一次消息可能落空，最多重试 3 次。
    let afterDouble = '';
    let doubleToast = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await cdp.eval(`(() => { const b = document.getElementById('bili-copy-float'); b.click(); b.click(); })()`);
      doubleToast = await waitFor(
        () => cdp.eval(`(() => { const t = document.getElementById('bili-copy-float-toast'); return t && /第 2 条/.test(t.textContent) ? t.textContent : ''; })()`),
        { timeout: 4000, interval: 150, what: '双击提示' },
      ).catch(() => '');
      afterDouble = await cdp
        .eval(`navigator.clipboard.readText().catch(() => '')`)
        .catch(() => '');
      if (afterDouble === 'BV1AM4y1M71p') break;
      await sleep(600);
    }
    check('双击提示「第 2 条」', /第 2 条/.test(doubleToast), doubleToast);
    check('双击后剪贴板是第 2 条（裸 BV 号）', afterDouble === 'BV1AM4y1M71p', String(afterDouble).slice(0, 60));

    // 右键：页面里弹出第 3 条起的菜单
    await cdp.eval(`(() => {
      const b = document.getElementById('bili-copy-float');
      b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1200, clientY: 700 }));
    })()`);
    const menuShown = await waitFor(
      () => cdp.eval(`document.querySelectorAll('#bili-copy-float-menu .bcf-menu-item').length`),
      { timeout: 8000, interval: 150, what: '右键菜单出现' },
    ).catch(() => 0);
    check('右键弹出 5 条线路 + 测速 + 设置', menuShown === 7, String(menuShown));

    const firstItem = await cdp.eval(`(() => { const n = document.querySelector('#bili-copy-float-menu .bcf-menu-item'); return n ? n.textContent : ''; })()`);
    check('菜单第一条是「3. 智能最快」', /^3\. 智能最快/.test(firstItem), firstItem);

    const inViewport = await cdp.eval(`(() => {
      const m = document.getElementById('bili-copy-float-menu');
      if (!m) return false;
      const r = m.getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    })()`);
    check('菜单完整落在视口内', inViewport === true);

    // 点菜单里的「4. 纯K线路」= 第 4 条（ckapi 前缀 + BV）
    const EXPECT_MENU_PICK = 'http://ckapi.sevenbrothers.cn/bili/api?id=BV1AM4y1M71p';
    let afterMenuPick = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const open = await cdp.eval(`Boolean(document.getElementById('bili-copy-float-menu'))`);
      if (!open) {
        await cdp.eval(`document.getElementById('bili-copy-float').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
        await waitFor(() => cdp.eval(`document.querySelectorAll('#bili-copy-float-menu .bcf-menu-item').length`), {
          timeout: 5000,
          interval: 150,
          what: '菜单重新打开',
        }).catch(() => 0);
      }
      await cdp.eval(`(() => {
        const items = document.querySelectorAll('#bili-copy-float-menu .bcf-menu-item');
        if (items[1]) items[1].click();
      })()`);
      afterMenuPick = await waitFor(
        () => cdp.eval(`navigator.clipboard.readText().catch(() => '')`).catch(() => ''),
        { timeout: 4000, interval: 200, what: '菜单线路写入剪贴板' },
      ).catch(() => '');
      if (afterMenuPick === EXPECT_MENU_PICK) break;
      await sleep(500);
    }
    check(
      '点菜单里的线路复制对应前缀 + BV',
      afterMenuPick === EXPECT_MENU_PICK,
      String(afterMenuPick).slice(0, 80),
    );

    const menuClosed = await cdp.eval(`Boolean(document.getElementById('bili-copy-float-menu'))`);
    check('选完菜单自动收起', menuClosed === false);
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
