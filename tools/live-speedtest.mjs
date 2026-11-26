/**
 * 真机测速（在 Node 里跑，不走浏览器，因此没有 CORS 限制）：
 * 用默认的 6 条线路对真实解析站 + 真实 CDN 跑一轮，用来验证算法、看真实数字。
 *
 * 注意：这一轮大概会发 ~20 个解析请求、下载几 MB 数据，别连着跑。
 *
 * 运行：node tools/live-speedtest.mjs [BV号] [quick|normal|deep]
 */

import { DEFAULT_ENTRIES } from '../src/lib/settings.js';
import { DEFAULT_TEST_BV, formatMbps, formatMs, runSpeedTest } from '../src/lib/speedtest.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const bv = process.argv[2] || DEFAULT_TEST_BV;
const depth = process.argv[3] || 'normal';

/** Node 的 fetch 不带浏览器 UA，而 B 站 CDN 会拒掉没有 UA 的请求。 */
const fetchImpl = (url, init = {}) =>
  fetch(url, {
    ...init,
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      referer: 'https://www.bilibili.com/',
      ...(init.headers || {}),
    },
  });

const started = Date.now();
console.log(`测试 BV：${bv}    档位：${depth}\n`);

let lastPhase = '';
const result = await runSpeedTest({
  entries: DEFAULT_ENTRIES,
  bv,
  depth,
  fetchImpl,
  onProgress: (evt) => {
    const line = `${evt.phase} ${evt.done}/${evt.total}`;
    if (line !== lastPhase) {
      lastPhase = line;
      process.stderr.write(`\r  ${line}   `);
    }
  },
});

process.stderr.write('\r' + ' '.repeat(40) + '\r');

const icon = { great: '⚡', good: '🟢', fair: '🟡', slow: '🟠', bad: '🔴', fail: '⛔', unknown: '❔', skipped: '➖' };
const pad = (text, width) => {
  const str = String(text ?? '');
  const len = [...str].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
  return str + ' '.repeat(Math.max(0, width - len));
};

console.log(pad('线路', 12) + pad('连通', 8) + pad('解析302', 10) + pad('最快节点', 24) + pad('CDN 延迟', 10) + '评级 / 节点');
console.log('-'.repeat(96));

for (const line of result.lines) {
  const name = line.note || line.host || `#${line.index + 1}`;
  const connectivity = line.state === 'ok' ? '✅' : line.state === 'skipped' ? '➖' : '❌';
  const best = line.bestCdn
    ? `${line.bestCdn.host.replace(/^upos-(sz|hz)-/, '').replace(/\.(bilivideo|akamaized)\.[a-z]+$/, '')}`
    : '—';
  console.log(
    pad(name, 12) +
      pad(connectivity, 8) +
      pad(formatMs(line.latencyMs), 10) +
      pad(best, 24) +
      pad(formatMs(line.bestCdn?.ttfbMs), 10) +
      `${icon[line.grade]} ${line.grade}` +
      (line.bestCdn ? `  ${formatMbps(line.bestCdn.mbps)}` : '') +
      (line.state !== 'ok' && line.reason ? `  (${line.reason})` : ''),
  );
  if (line.cdn.length > 1) {
    for (const cdn of line.cdn) {
      console.log(`    └ ${cdn.host}  ${formatMbps(cdn.mbps)}  CDN 延迟 ${formatMs(cdn.ttfbMs)}  ${cdn.error || ''}`);
    }
  }
}

console.log('-'.repeat(96));
console.log(
  `汇总：${result.summary.ok}/${result.summary.testable} 条线路可用，` +
    `最快节点 ${result.summary.bestHost || '—'} ${result.summary.bestMbps ? formatMbps(result.summary.bestMbps) : ''}，` +
    `用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒（${result.rounds} 轮）`,
);
for (const note of result.notes) console.log(`提示：${note}`);
