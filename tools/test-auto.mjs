/**
 * 「智能最快节点」的单元测试。
 *
 * 全部注入假的 fetch / 时钟，不碰真实网络；验证的重点是**决策路径**：
 *   同族节点 → 只解析一次 + 换 host 验证（省请求）
 *   跨族节点 → 只找上次真的吐出它的解析站，有限次重试
 *   换失败 → 退第二快、再不行给兜底地址
 *
 * 运行：node --test tools/test-auto.mjs
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AUTO_HOST_TRIES,
  AUTO_MAX_ATTEMPTS,
  AUTO_MIN_MBPS,
  isBilivideoHost,
  isRewritableCdn,
  pickFastest,
  rankCdns,
  rankResolvers,
  resolveUrlFor,
  swapCdnHost,
  describePick,
} from '../src/lib/auto.js';
import { DEFAULT_ENTRIES } from '../src/lib/settings.js';

const BV = 'BV1AM4y1M71p';
const FAST = 'upos-sz-estgcos.bilivideo.com';
const MID = 'upos-sz-mirrorcos.bilivideo.com';
const AKA = 'upos-hz-mirrorakam.akamaized.net';
const MP4_PATH = '/upgcxcode/02/94/364849402/364849402_da2-1-192.mp4?deadline=1&upsig=abc';

const cdnUrl = (host) => `https://${host}${MP4_PATH}`;

/** 造一个「看起来像 response」的对象：只用到 ok/status/url/body.cancel。 */
function makeResponse(url, status = 206) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    body: { cancel: async () => {} },
  };
}

/**
 * 假 fetch：routes 的键是「请求 URL 的前缀」，值是返回的最终地址（或状态码）。
 * 未命中就当网络错误，方便断言「没有发出不该发的请求」。
 */
function makeFetch(routes, log = []) {
  return async (url) => {
    log.push(url);
    for (const [prefix, result] of routes) {
      if (!url.startsWith(prefix)) continue;
      if (typeof result === 'number') {
        return result >= 400 ? Promise.reject(Object.assign(new Error(`HTTP ${result}`), { status: result })) : makeResponse(url, result);
      }
      if (result instanceof Error) throw result;
      return makeResponse(result, 206);
    }
    throw new Error(`意外请求：${url}`);
  };
}

/** 上一轮测速的结果（只保留 auto 用得到的字段）。 */
function speedResultWith(lines) {
  return { lines };
}

test('同族判断：只有 bilivideo.com 的 upgcxcode 直链能换 host', () => {
  assert.equal(isBilivideoHost(FAST), true);
  assert.equal(isBilivideoHost(AKA), false);
  assert.equal(isBilivideoHost(''), false);
  assert.equal(isRewritableCdn(cdnUrl(FAST)), true);
  assert.equal(isRewritableCdn(cdnUrl(AKA)), false, 'akamai 是另一套签名');
  assert.equal(
    isRewritableCdn('https://xy1x2x3x4xy.mcdn.bilivideo.cn:8082/v1/resource/abc.m4s'),
    false,
    'PCDN 分片换 host 会 403',
  );
});

test('换 host 只改域名，path / query / 签名原样保留', () => {
  const swapped = swapCdnHost(cdnUrl('upos-sz-mirror08c.bilivideo.com'), FAST);
  assert.equal(swapped, cdnUrl(FAST));
  assert.equal(swapCdnHost(cdnUrl(FAST), AKA), null, '跨族不允许换');
  assert.equal(swapCdnHost('not a url', FAST), null);
  assert.equal(swapCdnHost(cdnUrl(FAST), ''), null);
});

test('节点排行：同一节点在多条线路出现取最快值并按速率降序', () => {
  const ranked = rankCdns(
    speedResultWith([
      { index: 0, cdn: [{ host: MID, mbps: 1.9, ttfbMs: 120, pct: 100 }] },
      {
        index: 3,
        cdn: [
          { host: FAST, mbps: 12.7, ttfbMs: 233, pct: 40 },
          { host: MID, mbps: 1.6, ttfbMs: 90, pct: 60 },
        ],
      },
    ]),
  );
  assert.deepEqual(ranked.map((item) => item.host), [FAST, MID]);
  assert.equal(ranked[0].mbps, 12.7);
  assert.equal(ranked[0].pct, 40);
  assert.deepEqual(ranked[1].fromLines, [0, 3], '同一个节点要记住哪些线路吐过它');
  assert.equal(ranked[1].mbps, 1.9, '同一节点取最快的一次测量');
  assert.equal(ranked[1].ttfbMs, 90, '首包取更小的那个');
});

test('线路排序：按上次 302 延迟升序，跳过智能条目与空前缀', () => {
  const entries = [
    { type: 'bv', value: 'https://slow.example/?u=', note: '慢' },
    { type: 'bv', value: '', note: '空' },
    { type: 'auto', value: '', note: '智能' },
    { type: 'bv', value: 'https://fast.example/?u=', note: '快' },
  ];
  const ranked = rankResolvers(entries, speedResultWith([{ index: 0, latencyMs: 2100 }, { index: 3, latencyMs: 110 }]));
  assert.deepEqual(ranked.map((item) => item.index), [3, 0], '快的排前面，没测过的排最后');
  assert.equal(ranked.length, 2);
});

test('解析 URL：接 BV 号的原样接 BV，接链接的拼视频页（带分P）', () => {
  assert.equal(resolveUrlFor({ type: 'bv', value: 'https://api.xuan25.com/bili-resolve/' }, BV), `https://api.xuan25.com/bili-resolve/${BV}`);
  assert.equal(
    resolveUrlFor({ type: 'url', value: 'https://bil.ouo.chat/player/?url=' }, BV, 2),
    `https://bil.ouo.chat/player/?url=https://www.bilibili.com/video/${BV}?p=2`,
  );
  assert.equal(resolveUrlFor({ type: 'bv', value: '' }, BV), '', '空前缀不联网');
});

test('同族最快节点：只解析一次，换 host 验证通过就直接给', async () => {
  const log = [];
  const doFetch = makeFetch(
    [
      ['https://api.xuan25.com/bili-resolve/', cdnUrl('upos-sz-mirror08c.bilivideo.com')],
      [`https://${FAST}/`, cdnUrl(FAST)],
    ],
    log,
  );
  const picked = await pickFastest({
    entries: DEFAULT_ENTRIES,
    bvid: BV,
    speedResult: speedResultWith([{ index: 0, latencyMs: 300, cdn: [{ host: FAST, mbps: 12.7, ttfbMs: 200, pct: 100 }] }]),
    fetchImpl: doFetch,
    clock: () => 0,
  });
  assert.equal(picked.ok, true);
  assert.equal(picked.via, 'rewrite');
  assert.equal(picked.host, FAST);
  assert.equal(picked.mbps, 12.7);
  assert.equal(picked.attempts, 1, '同族只需要 1 次解析');
  assert.equal(log.length, 2, '一次解析 + 一次 1 字节验证');
  assert.match(describePick(picked), /智能最快：upos-sz-estgcos\.bilivideo\.com · 12\.70 MB\/s（换节点，1 次解析/);
});

test('最快的换过去验证失败时，自动退第二快', async () => {
  const log = [];
  const doFetch = async (url) => {
    log.push(url);
    if (url.startsWith('https://api.xuan25.com/')) {
      return makeResponse(cdnUrl('upos-sz-mirror08c.bilivideo.com'), 206);
    }
    if (url.startsWith(`https://${FAST}/`)) return makeResponse(url, 403);
    if (url.startsWith(`https://${MID}/`)) return makeResponse(url, 206);
    throw new Error(`意外请求：${url}`);
  };
  const picked = await pickFastest({
    entries: DEFAULT_ENTRIES,
    bvid: BV,
    speedResult: speedResultWith([
      {
        index: 0,
        latencyMs: 300,
        cdn: [
          { host: FAST, mbps: 12.7 },
          { host: MID, mbps: 1.9 },
        ],
      },
    ]),
    fetchImpl: doFetch,
    clock: () => 0,
  });
  assert.equal(picked.ok, true);
  assert.equal(picked.host, MID, '退到第二快的节点');
  assert.equal(picked.via, 'rewrite');
  assert.equal(log.filter((url) => url.includes('bili-resolve')).length, 1, '依旧只解析一次');
});

test('跨族节点：只找上次吐出它的解析站，拿到后验一次', async () => {
  const log = [];
  const doFetch = makeFetch(
    [
      ['https://biliplayer.91vrchat.com/player/?url=', cdnUrl(AKA)],
      [`https://${AKA}/`, cdnUrl(AKA)],
    ],
    log,
  );
  const picked = await pickFastest({
    entries: DEFAULT_ENTRIES,
    bvid: BV,
    speedResult: speedResultWith([{ index: 5, latencyMs: 1400, cdn: [{ host: AKA, mbps: 6.8, pct: 100 }] }]),
    fetchImpl: doFetch,
    clock: () => 0,
  });
  assert.equal(picked.ok, true);
  assert.equal(picked.via, 'resolver', '跨族只能重新解析');
  assert.equal(picked.host, AKA);
  assert.deepEqual(log, [`https://biliplayer.91vrchat.com/player/?url=${BV}`, cdnUrl(AKA)]);
});

test('跨族节点拿不到时，退到下一条同族节点', async () => {
  const doFetch = async (url) => {
    if (url.startsWith('https://biliplayer.91vrchat.com/')) throw new Error('连不上');
    if (url.startsWith('https://api.xuan25.com/')) return makeResponse(cdnUrl('upos-sz-mirror08c.bilivideo.com'), 206);
    if (url.startsWith(`https://${FAST}/`)) return makeResponse(url, 206);
    throw new Error(`意外请求：${url}`);
  };
  const picked = await pickFastest({
    entries: DEFAULT_ENTRIES,
    bvid: BV,
    speedResult: speedResultWith([
      { index: 5, latencyMs: 100, cdn: [{ host: AKA, mbps: 6.8 }] },
      { index: 0, latencyMs: 900, cdn: [{ host: FAST, mbps: 12.7 }] },
    ]),
    fetchImpl: doFetch,
    clock: () => 0,
  });
  assert.equal(picked.ok, true);
  assert.equal(picked.host, FAST);
  assert.equal(picked.via, 'rewrite');
});

test('没有测速数据时：按线路顺序解析一次，不再挑节点', async () => {
  const log = [];
  const doFetch = makeFetch([['https://api.xuan25.com/bili-resolve/', cdnUrl('upos-sz-estgoss.bilivideo.com')]], log);
  const picked = await pickFastest({ entries: DEFAULT_ENTRIES, bvid: BV, fetchImpl: doFetch, clock: () => 0 });
  assert.equal(picked.ok, true);
  assert.equal(picked.via, 'resolver');
  assert.equal(picked.reason, '还没有测速数据，按线路顺序解析');
  assert.equal(log.length, 1);
});

test('全部失败：明确报错，不返回半截地址', async () => {
  const doFetch = async () => {
    throw new Error('连不上');
  };
  const picked = await pickFastest({ entries: DEFAULT_ENTRIES, bvid: BV, fetchImpl: doFetch, clock: () => 0 });
  assert.equal(picked.ok, false);
  assert.equal(picked.url, '');
  assert.match(picked.reason, /都没能拿到|都没拿到/);
  assert.equal(picked.attempts <= AUTO_MAX_ATTEMPTS, true, '解析次数不超过上限');
});

test('页面没有 BV 号时直接失败，不发请求', async () => {
  let called = 0;
  const picked = await pickFastest({
    entries: DEFAULT_ENTRIES,
    bvid: '',
    fetchImpl: async () => {
      called += 1;
      return makeResponse('', 206);
    },
    clock: () => 0,
  });
  assert.equal(picked.ok, false);
  assert.equal(picked.reason, '这个页面没有 BV 号');
  assert.equal(called, 0);
});

test('超预算后不再发新请求（保证点击后不会无限等待）', async () => {
  let t = 0;
  const log = [];
  const doFetch = async (url) => {
    log.push(url);
    t += 4000;
    throw new Error('超时');
  };
  const picked = await pickFastest({
    entries: DEFAULT_ENTRIES,
    bvid: BV,
    speedResult: speedResultWith([{ index: 0, latencyMs: 300, cdn: [{ host: FAST, mbps: 9 }] }]),
    fetchImpl: doFetch,
    clock: () => t,
    budgetMs: 9000,
  });
  assert.equal(picked.ok, false);
  assert.equal(log.length <= 3, true, `预算内最多打 3 次，实际 ${log.length}`);
  assert.equal(AUTO_HOST_TRIES, 3);
  assert.equal(AUTO_MIN_MBPS, 0.5);
});
