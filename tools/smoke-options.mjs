#!/usr/bin/env node
/**
 * 在真实浏览器里给设置页做冒烟测试（不需要 Playwright）。
 *
 *   node tools/smoke-options.mjs            # 默认找 Edge，找不到再找 Chrome（headless）
 *   node tools/smoke-options.mjs --show     # 显示窗口，方便肉眼看（调试用）
 *   set EDGE_PATH=D:\path\msedge.exe && node tools/smoke-options.mjs
 *
 * 做的事：用临时用户目录 + --load-extension 启动浏览器，打开 options.html，
 *        检查渲染出来的行数 / 备注 / 预览 / 菜单标题，模拟「改备注、添加一条、恢复默认」，
 *        最后收集控制台异常。任何一条不符合预期就以退出码 1 结束。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extensionIdFromPrefs, launchBrowser, openOptionsPage, sleep, waitExtensionId, waitFor } from './lib/browser.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(HERE, '..');
const SHOW = process.argv.includes('--show');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? `  ${detail}` : ''}`);
}

const browser = await launchBrowser({ extDir: EXT_DIR, headless: !SHOW });
console.log(`浏览器：${browser.browserPath}`);
console.log(`扩展目录：${EXT_DIR}`);
console.log(`临时用户目录：${browser.profileDir}\n`);

let cdp = null;
let exitCode = 0;

try {
  const extId = await waitExtensionId(browser.port).catch(() => extensionIdFromPrefs(browser.profileDir, EXT_DIR));
  check('扩展已加载', Boolean(extId), extId);
  if (!extId) throw new Error('扩展没有被加载，检查 manifest.json 是否有语法问题');

  const page = await openOptionsPage(browser.port, extId);
  cdp = page.cdp;
  check('设置页已打开', page.target.url === page.pageUrl, page.target.url);

  // options.js 是 type=module 且有顶层 await，等 #list 里出现行再断言
  await waitFor(() => cdp.eval(`document.readyState === 'complete' && document.querySelectorAll('#list .entry').length > 0`), {
    what: '设置页渲染出线路行',
  });

  const snap = await cdp.eval(`(() => {
    const rows = [...document.querySelectorAll('#list .entry')];
    const pick = (row, sel) => row.querySelector(sel)?.value ?? '';
    const text = (sel) => (document.querySelector(sel)?.textContent || '').trim();
    return {
      title: document.title,
      rows: rows.length,
      mainWidth: getComputedStyle(document.querySelector('main')).maxWidth,
      entries: rows.map((row) => ({
        type: row.querySelector('select')?.value,
        value: pick(row, 'input[data-role="value"]'),
        note: pick(row, 'input[data-role="note"]'),
        role: (row.querySelector('.role')?.textContent || '').trim(),
        roleClass: row.querySelector('.role')?.className || '',
        noteMaxLength: row.querySelector('input[data-role="note"]')?.maxLength ?? -1,
        placeholder: row.querySelector('input[data-role="value"]')?.placeholder ?? '',
        disabled: row.querySelector('input[data-role="value"]')?.disabled ?? false,
      })),
      single: text('#preview-single'),
      double: text('#preview-double'),
      menu: [...document.querySelectorAll('#preview-menu .item')].map((item) => ({
        name: (item.querySelector('.name')?.textContent || '').trim(),
        code: (item.querySelector('code')?.textContent || '').trim(),
      })),
      depthOptions: [...document.querySelectorAll('#speed-depth option')].map((o) => o.value),
      speedBv: document.querySelector('#speed-bv')?.value ?? '',
      speedEmptyHint: text('#speed-result'),
    };
  })()`);

  check('页面标题', /BV|线路|复制/.test(snap.title), snap.title);
  check('默认 7 条线路', snap.rows === 7, `实际 ${snap.rows} 条`);
  check(
    '默认类型：第 3 条是智能最快，其余接 BV 号',
    JSON.stringify(snap.entries.map((e) => e.type)) ===
      JSON.stringify(['bv', 'bv', 'auto', 'bv', 'bv', 'bv', 'bv']),
    snap.entries.map((e) => e.type).join(','),
  );
  check(
    '默认线路顺序正确',
    JSON.stringify(snap.entries.map((e) => e.value)) ===
      JSON.stringify([
        'https://api.xuan25.com/bili-resolve/',
        '',
        '',
        'http://ckapi.sevenbrothers.cn/bili/api?id=',
        'https://bil.ouo.chat/player/?url=',
        'https://biliplayer.91vrchat.com/player/?url=',
        'https://ktv.chiooone.com/player/?url=',
      ]),
    snap.entries.map((e) => e.value.replace(/^https?:\/\//, '') || '(空)').join(' | '),
  );
  check(
    '默认备注正确',
    JSON.stringify(snap.entries.map((e) => e.note)) ===
      JSON.stringify(['后海线路', '复制BV号', '智能最快', '纯K线路', '星流线路', '孤线路', '暖夜线路']),
    snap.entries.map((e) => e.note).join(' / '),
  );
  check(
    '智能条目输入框不可编辑',
    snap.entries[2]?.disabled === true && /不用填前缀/.test(snap.entries[2]?.placeholder || ''),
    `${snap.entries[2]?.disabled} / ${snap.entries[2]?.placeholder}`,
  );
  check('备注框 maxlength=24', snap.entries.every((e) => e.noteMaxLength === 24));
  check(
    '空前缀行提示「空着为复制BV号」',
    /空着为复制BV号/.test(snap.entries[1]?.placeholder || ''),
    snap.entries[1]?.placeholder,
  );
  check(
    '行内用途标签：单击 / 双击 / 菜单',
    snap.entries.map((e) => e.role).slice(0, 4).join(',') === '单击,双击,菜单,菜单',
    snap.entries.map((e) => e.role).join(','),
  );
  check('单击预览 = 第 1 条线路', /xuan25|BV1fMYi6EEaP/.test(snap.single), snap.single.slice(0, 62));
  check('双击预览 = 裸 BV 号', snap.double === 'BV1fMYi6EEaP', snap.double);
  check('右键菜单预览：5 条线路（第 3~7 条）', snap.menu.length === 5, snap.menu.map((m) => m.name).join(' / '));
  check('菜单里没有「复制 BV 号」独立项', !snap.menu.some((m) => /^复制 ?BV/.test(m.name)));
  check('菜单首项是智能最快条目', snap.menu[0]?.name?.startsWith('3. 智能最快'), snap.menu[0]?.name);
  check('菜单第 2 项带备注名', snap.menu[1]?.name?.startsWith('4. 纯K线路'), snap.menu[1]?.name);
  check('测速档位：快速 / 标准 / 深入', snap.depthOptions.join(',') === 'quick,normal,deep', snap.depthOptions.join(','));
  check('测速面板默认测试 BV', snap.speedBv === 'BV1AM4y1M71p', snap.speedBv);
  check('测速面板空态有提示', /还没有测速记录/.test(snap.speedEmptyHint), snap.speedEmptyHint.slice(0, 40));
  check('页面宽度 ≥ 800px', parseFloat(snap.mainWidth) >= 800, snap.mainWidth);

  // 交互：改备注 → 菜单预览同步 → 写入 storage
  const afterNote = await cdp.eval(`(async () => {
    const input = document.querySelectorAll('#list .entry input[data-role="note"]')[2];
    input.value = '纯K · 改过';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    for (let i = 0; i < 20; i += 1) {
      const name = document.querySelector('#preview-menu .item .name')?.textContent?.trim() || '';
      if (name.includes('纯K · 改过')) return { name };
      await new Promise((r) => setTimeout(r, 100));
    }
    return { name: document.querySelector('#preview-menu .item .name')?.textContent?.trim() || '' };
  })()`);
  check('改备注后菜单预览同步', afterNote.name.includes('纯K · 改过'), afterNote.name);

  // 存档是 400ms 防抖，别用固定 sleep 赌时序，轮询到为止
  const stored = await waitFor(
    async () => {
      const notes = await cdp.eval(`(async () => {
        const s = await chrome.storage.sync.get('linkPrefixes');
        return (s.linkPrefixes || []).map((e) => e.note);
      })()`);
      return notes[2] === '纯K · 改过' ? notes : '';
    },
    { timeout: 6000, interval: 200, what: '备注写进 storage' },
  ).catch(() => []);
  check('改备注已写入 storage', stored[2] === '纯K · 改过', JSON.stringify(stored));

  const afterAdd = await cdp.eval(`(async () => {
    document.querySelector('#add').click();
    await new Promise((r) => setTimeout(r, 80));
    return {
      rows: document.querySelectorAll('#list .entry').length,
      lastType: document.querySelector('#list .entry:last-child select')?.value,
      lastRole: (document.querySelector('#list .entry:last-child .role')?.textContent || '').trim(),
    };
  })()`);
  check(
    '点「添加」多一行且是菜单项',
    afterAdd.rows === 8 && afterAdd.lastRole === '菜单',
    `${afterAdd.rows} 行 / ${afterAdd.lastRole} / ${afterAdd.lastType}`,
  );

  const afterReset = await cdp.eval(`(async () => {
    document.querySelector('#reset').click();
    await new Promise((r) => setTimeout(r, 250));
    const notes = [...document.querySelectorAll('#list .entry input[data-role="note"]')].map((i) => i.value);
    return { rows: notes.length, notes };
  })()`);
  check(
    '「恢复默认」回到 7 条默认线路',
    afterReset.rows === 7 && afterReset.notes[0] === '后海线路' && afterReset.notes[6] === '暖夜线路',
    afterReset.notes.join(' / '),
  );

  check('页面没有未捕获异常 / console.error', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
} catch (err) {
  console.error(`\n冒烟测试失败：${err.message}`);
  if (cdp) {
    try {
      const info = await cdp.eval(
        `({ url: location.href, title: document.title, ready: document.readyState, body: document.body ? document.body.innerHTML.slice(0, 600) : '(no body)' })`,
      );
      console.error('页面现场：', JSON.stringify(info, null, 2).slice(0, 1200));
    } catch (e2) {
      console.error('连页面都读不到：', e2.message);
    }
  }
  exitCode = 1;
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n共 ${results.length} 项，通过 ${results.length - failed.length} 项${failed.length ? `，失败 ${failed.length} 项` : ''}`);
  if (failed.length) exitCode = 1;
  else if (exitCode === 0) console.log('设置页冒烟测试全部通过 ✔');
  cdp?.close();
  browser.kill();
  await sleep(300);
  process.exit(exitCode);
}
