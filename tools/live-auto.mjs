/**
 * 真机验证「智能最快节点」：先跑一轮真测速，再让 pickFastest 真去拿直链，
 * 最后用 Range 请求验证拿到的地址真的能播。
 *
 * 运行：node tools/live-auto.mjs [BV号]
 */
import { DEFAULT_ENTRIES } from '../src/lib/settings.js';
import { DEFAULT_TEST_BV, formatMbps, runSpeedTest } from '../src/lib/speedtest.js';
import { describePick, pickFastest, rankCdns } from '../src/lib/auto.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
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

const bv = process.argv[2] || DEFAULT_TEST_BV;
console.log(`测试 BV：${bv}\n`);

const speed = await runSpeedTest({ entries: DEFAULT_ENTRIES, bv, depth: 'quick', fetchImpl });
const ranked = rankCdns(speed);
console.log('测出来的节点排行：');
for (const item of ranked.slice(0, 6)) {
  console.log(`  ${item.host.padEnd(38)} ${formatMbps(item.mbps).padStart(10)}  (来自 ${item.fromLines.join('/')})`);
}

const started = Date.now();
const picked = await pickFastest({ entries: DEFAULT_ENTRIES, bvid: bv, p: 1, speedResult: speed, fetchImpl });
console.log(`\n智能挑点：${describePick(picked)}`);
console.log(`耗时：${Date.now() - started} ms，尝试 ${picked.attempts} 次，路线 ${picked.via}`);
for (const step of picked.trail) console.log(`  · ${JSON.stringify(step)}`);

if (picked.ok) {
  const res = await fetchImpl(picked.url, { headers: { range: 'bytes=0-262143' } });
  const buf = await res.arrayBuffer();
  console.log(`\n验证：HTTP ${res.status}，${buf.byteLength} 字节，${(res.headers.get('content-type') || '')}`);
} else {
  console.log('\n没拿到可用地址');
  process.exitCode = 1;
}
