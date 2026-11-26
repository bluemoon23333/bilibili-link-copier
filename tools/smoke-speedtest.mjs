#!/usr/bin/env node
/**
 * 在真实浏览器里跑一遍「线路测速」，验证 CORS / 权限 / 302 跟随 / Range 下载都能走通。
 *
 *   node tools/smoke-speedtest.mjs            # 默认 normal（3 轮）
 *   node tools/smoke-speedtest.mjs quick      # 快一点
 *
 * 说明：正式版把跨域权限做成了「可选权限」，第一次点测速会弹一个授权框。
 *      无头浏览器没法点系统弹框，所以这里把扩展复制到临时目录，
 *      把 optional_host_permissions 改成 host_permissions（安装即授权），
 *      其余代码一行不改 —— 验证的就是真实测速逻辑。
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extensionIdFromPrefs, launchBrowser, openOptionsPage, sleep, waitExtensionId, waitFor } from './lib/browser.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(HERE, '..');
const DEPTH = process.argv[2] || 'normal';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? `  ${detail}` : ''}`);
}

// 1) 复制一份扩展，把可选权限改成安装即授权
const workDir = mkdtempSync(join(tmpdir(), 'bvc-speed-'));
const extCopy = join(workDir, 'ext');
const SKIP = new Set(['dist', 'node_modules', '.git']);
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
console.log(`扩展副本：${extCopy}（host_permissions 已写死，免授权弹框）`);

const browser = await launchBrowser({ extDir: extCopy });
console.log(`浏览器：${browser.browserPath}\n`);

let cdp = null;
let exitCode = 0;
try {
  const extId = await waitExtensionId(browser.port).catch(() => extensionIdFromPrefs(browser.profileDir, extCopy));
  if (!extId) throw new Error('扩展加载失败（检查 manifest 或 src 是否有语法错误）');
  check('扩展已加载', true, extId);

  const page = await openOptionsPage(browser.port, extId);
  cdp = page.cdp;
  await waitFor(() => cdp.eval(`document.querySelectorAll('#list .entry').length > 0`), { what: '设置页渲染' });

  const granted = await cdp.eval(`chrome.permissions.contains({ origins: ['<all_urls>'] })`);
  check('跨域权限已就绪', granted === true, String(granted));

  // 2) 选档位 → 点开始
  await cdp.eval(`(() => {
    const sel = document.querySelector('#speed-depth');
    sel.value = ${JSON.stringify(DEPTH)};
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#speed-run').click();
    return true;
  })()`);

  // 3) 等结果表出来（第一行出现且状态不再是「正在」）
  await waitFor(
    async () =>
      cdp.eval(`(() => {
        const rows = [...document.querySelectorAll('#speed-result tbody tr')].filter((r) => !r.classList.contains('detail'));
        const status = (document.querySelector('#speed-status')?.textContent || '').trim();
        return rows.length >= 3 && /测速完成|测速失败|已停止/.test(status);
      })()`),
    { timeout: 120000, interval: 500, what: '测速跑完并渲染结果' },
  );

  const shot = await cdp.eval(`(() => {
    const table = document.querySelector('#speed-result table');
    const heads = table ? [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()) : [];
    const rows = table
      ? [...table.querySelectorAll('tbody tr')].map((tr) =>
          [...tr.children].map((td) => td.textContent.replace(/\\s+/g, ' ').trim()),
        )
      : [];
    return {
      status: (document.querySelector('#speed-status')?.textContent || '').trim(),
      heads,
      rows,
      text: (document.querySelector('#speed-result')?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 900),
      legend: (document.querySelector('#speed-result .speed-legend')?.textContent || '').trim(),
      details: [...document.querySelectorAll('#speed-result tbody tr.detail')].map((tr) =>
        (tr.textContent || '').replace(/\\s+/g, ' ').trim(),
      ),
    };
  })()`);

  console.log(`\n状态：${shot.status}`);
  console.log(`表头：${shot.heads.join(' | ')}`);
  for (const row of shot.rows) console.log(`  ${row.join(' | ')}`);
  console.log('');

  const headRows = shot.rows.filter((r) => r.length >= 7);
  const stored = await cdp.eval(`(async () => {
    const s = await chrome.storage.local.get('speedTestResult');
    return s.speedTestResult || null;
  })()`);

  check(
    '表头是通俗说法',
    shot.heads.join('|') === '线路|连通|解析延迟|节点数|最快节点|CDN 延迟|评级',
    shot.heads.join('|'),
  );
  check(
    '表格下面一句话说明两种延迟',
    /解析延迟/.test(shot.legend) && /CDN 延迟/.test(shot.legend) && /两个阶段/.test(shot.legend),
    shot.legend.slice(0, 60),
  );
  check(
    '空条目（空前缀 + 智能最快）不出现在表里',
    headRows.length === 5,
    `${headRows.length} 行（应为 5：7 条减去 2 条不联网的）`,
  );
  check('结果已写入 storage.local', Boolean(stored) && Array.isArray(stored.lines), stored ? `${stored.lines.length} 条` : 'null');

  const lines = stored?.lines || [];
  const okLines = lines.filter((l) => l.state === 'ok');
  const skipped = lines.filter((l) => l.state === 'skipped');
  check(
    '不联网的条目（空前缀 + 智能最快）标成「不联网」而不是失败',
    skipped.length === 2 && skipped.every((l) => l.state === 'skipped' && /不联网|不参与测速/.test(l.reason || '')),
    skipped.map((l) => `${l.note}:${l.reason}`).join(' / '),
  );
  check('至少 4 条线路解析成功', okLines.length >= 4, `${okLines.length}/${lines.length - skipped.length} 条成功`);

  const withCdn = okLines.filter((l) => (l.hosts || []).length > 0);
  check('成功线路都拿到了 CDN 节点', withCdn.length === okLines.length, withCdn.map((l) => l.bestCdn?.host || l.hosts[0]).join(' / '));

  const resolverSelf = okLines.filter((l) => (l.hosts || []).includes((l.host || '').replace(/^www\./, '')));
  check('没有把解析站自己当成 CDN 节点', resolverSelf.length === 0, resolverSelf.map((l) => l.host).join(','));

  const withPct = okLines.filter((l) => l.cdn.some((n) => Number.isFinite(n.pct)));
  check('每个 CDN 节点都带了出现概率', withPct.length === okLines.length, `${withPct.length}/${okLines.length} 条`);
  check(
    '展开行里写明了出现轮次与百分比',
    shot.details.length > 0 && shot.details.every((d) => /出现 \d+\/\d+ 轮（\d+%）/.test(d)),
    shot.details[0]?.slice(0, 80) || '(没有展开行)',
  );

  const withSpeed = okLines.filter((l) => (l.bestCdn?.mbps || 0) > 0);
  check('至少有一条量到了速率', withSpeed.length >= 3, withSpeed.map((l) => `${l.note} ${l.bestCdn.mbps.toFixed(2)}MB/s`).join(' / '));

  const graded = okLines.filter((l) => l.grade && l.grade !== 'unknown');
  check('成功线路都有评级', graded.length === okLines.length, okLines.map((l) => `${l.note}:${l.grade}`).join(' '));

  const failed = lines.filter((l) => l.state === 'fail');
  check(
    '失败线路带原因（不是空白）',
    failed.every((l) => (l.reason || '').length > 0),
    failed.map((l) => `${l.note}: ${l.reason}`).join(' / ') || '(本轮无失败)',
  );

  const errors = page.errors.filter((e) => !/Failed to load resource/.test(e));
  check('页面没有未捕获异常', errors.length === 0, errors.slice(0, 3).join(' | '));

  const perLine = okLines.map((l) => `${l.note}→${l.bestCdn?.host || '?'} ${l.bestCdn?.mbps?.toFixed(2) ?? '?'}MB/s`).join('，');
  console.log(`\n实际结果：${perLine}`);
  console.log(`总用时：${stored ? (stored.durationMs / 1000).toFixed(1) : '?'} 秒（${stored?.rounds} 轮 × ${stored?.lines?.length} 条线路）`);

  // 4) 再进一次页面，确认上次结果会自动回显
  const second = await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/src/options.html` });
  void second;
  await sleep(1500);
  const targets = await (await fetch(`http://127.0.0.1:${browser.port}/json/list`)).json();
  const pages = targets.filter((t) => (t.url || '').endsWith('/src/options.html'));
  if (pages.length >= 2) {
    const { Cdp } = await import('./lib/browser.mjs');
    const cdp2 = await Cdp.open(pages[pages.length - 1].webSocketDebuggerUrl);
    await cdp2.send('Runtime.enable');
    const recalled = await waitFor(
      () => cdp2.eval(`document.querySelector('#speed-result')?.textContent?.includes('最快节点') || false`),
      { timeout: 15000, what: '重开页面回显上次结果' },
    );
    check('重开设置页会显示上次测速结果', recalled === true);
    cdp2.close();
  } else {
    check('重开设置页会显示上次测速结果', false, '没能开第二个标签页');
  }
} catch (err) {
  console.error(`\n浏览器测速冒烟失败：${err.message}`);
  if (cdp) {
    try {
      const info = await cdp.eval(
        `({ status: document.querySelector('#speed-status')?.textContent || '', result: (document.querySelector('#speed-result')?.textContent || '').slice(0, 500) })`,
      );
      console.error('页面现场：', JSON.stringify(info, null, 2).slice(0, 1200));
    } catch (e2) {
      console.error('读页面失败：', e2.message);
    }
  }
  exitCode = 1;
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n共 ${results.length} 项，通过 ${results.length - failed.length} 项${failed.length ? `，失败 ${failed.length} 项` : ''}`);
  if (failed.length) exitCode = 1;
  else if (exitCode === 0) console.log('浏览器内测速冒烟测试全部通过 ✔');
  cdp?.close();
  browser.kill();
  await sleep(300);
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {}
  process.exit(exitCode);
}
