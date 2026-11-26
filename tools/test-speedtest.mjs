/**
 * 线路测速的单元测试：用假的 fetch / 时钟跑 runSpeedTest，验证
 *   - 解析站 302 延迟、多轮探测、CDN 去重与速率计算
 *   - 空前缀不联网、失败样本、样本过小、外部取消
 *   - 评级、汇总与提示
 *
 * 运行：node --test tools/test-speedtest.mjs
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TEST_BV,
  GRADES,
  SPEED_DEPTHS,
  LIMITS,
  formatMbps,
  formatMs,
  gradeLatency,
  gradeSpeed,
  hostOf,
  probeUrlFor,
  runSpeedTest,
} from '../src/lib/speedtest.js';

const BV = DEFAULT_TEST_BV;

/* ---------------------------------------------------------------- *
 * 假的 fetch：按 URL 分派，记录调用，便于断言「请求了几次、怎么发的」
 * ---------------------------------------------------------------- */

function makeStream({ totalBytes, chunkBytes = 1024 * 1024, onChunk = () => {} }) {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - sent);
      sent += size;
      onChunk();
      controller.enqueue(new Uint8Array(size));
    },
  });
}

function mediaResponse({ url, status = 206, body = null, redirected = true, headers = {} }) {
  return {
    url,
    status,
    redirected,
    type: 'basic',
    headers: new Headers({ 'content-type': 'video/mp4', ...headers }),
    body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

const opaqueRedirect = (url) => ({
  type: 'opaqueredirect',
  status: 0,
  url,
  headers: new Headers(),
  body: null,
});

/**
 * routes: { [url]: { manual?, follow?: () => response, throw?: string } }
 */
function makeFetch(routes, { onCall = () => {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, redirect: init.redirect, range: init.headers?.Range || '' });
    onCall(url, init);
    const route = routes[url];
    if (!route) throw new TypeError(`Failed to fetch: ${url}`);
    if (route.throw) throw new TypeError(route.throw);
    if (init.redirect === 'manual') return route.manual || opaqueRedirect(url);
    if (init.redirect === 'follow') {
      if (!route.follow) throw new TypeError('unexpected request');
      // 每次请求都新建一份 body：真实浏览器不会复用同一条流。
      return typeof route.follow === 'function' ? route.follow() : route.follow;
    }
    throw new TypeError('unexpected request');
  };
  return { fetchImpl, calls };
}

/* ---------------------------------------------------------------- *
 * 纯函数
 * ---------------------------------------------------------------- */

test('空前缀 = 只在本地复制，不联网', () => {
  assert.equal(probeUrlFor({ type: 'bv', value: '', note: '复制BV号' }, BV), '');
  assert.equal(probeUrlFor({ type: 'bv', value: '   ' }, BV), '');
  assert.equal(probeUrlFor(undefined, BV), '');
});

test('探活地址：接 BV 号类型直接接 BV，接链接类型接 B 站页面', () => {
  assert.equal(
    probeUrlFor({ type: 'bv', value: 'https://api.xuan25.com/bili-resolve/' }, BV),
    `https://api.xuan25.com/bili-resolve/${BV}`,
  );
  assert.equal(
    probeUrlFor({ type: 'url', value: 'https://bil.ouo.chat/player/?url=' }, BV),
    `https://bil.ouo.chat/player/?url=https://www.bilibili.com/video/${BV}`,
  );
});

test('JSON 接口条目：拼出带 bv/p/format/otype 的接口地址', () => {
  const url = probeUrlFor({ type: 'api', value: 'https://api.squidtail.com/bili2vrc/parse/' }, BV);
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://api.squidtail.com/bili2vrc/parse/');
  assert.equal(parsed.searchParams.get('bv'), BV);
  assert.equal(parsed.searchParams.get('p'), '1');
  assert.equal(parsed.searchParams.get('format'), 'mp4');
  assert.equal(parsed.searchParams.get('otype'), 'json');
});

test('主机名提取', () => {
  assert.equal(hostOf('https://upos-sz-estgcos.bilivideo.com/a/b.mp4?x=1'), 'upos-sz-estgcos.bilivideo.com');
  assert.equal(hostOf('not a url'), '');
});

test('评级阈值：速率与延迟', () => {
  assert.equal(gradeSpeed(12), 'great');
  assert.equal(gradeSpeed(3), 'good');
  assert.equal(gradeSpeed(1.2), 'fair');
  assert.equal(gradeSpeed(0.5), 'slow');
  assert.equal(gradeSpeed(0.49), 'bad');
  assert.equal(gradeSpeed(0), 'unknown');
  assert.equal(gradeSpeed(null), 'unknown');

  assert.equal(gradeLatency(120), 'great');
  assert.equal(gradeLatency(400), 'great');
  assert.equal(gradeLatency(901), 'fair');
  assert.equal(gradeLatency(2600), 'slow');
  assert.equal(gradeLatency(-1), 'unknown');
});

test('数值格式化', () => {
  assert.equal(formatMbps(12.34), '12.3 MB/s');
  assert.equal(formatMbps(1.234), '1.23 MB/s');
  assert.equal(formatMbps(0.25), '256 KB/s');
  assert.equal(formatMbps(null), '—');
  assert.equal(formatMs(3.14), '3.1 ms');
  assert.equal(formatMs(321.6), '322 ms');
  assert.equal(Object.keys(GRADES).length, 8);
  assert.equal(GRADES.fair.label, '可用', '🟡 这一档叫「可用」，不是「一般」');
});

/* ---------------------------------------------------------------- *
 * 端到端（假网络）
 * ---------------------------------------------------------------- */

test('完整一轮：302 延迟、多轮探测、CDN 去重、速率与评级', async () => {
  let t = 0;
  const clock = () => t;

  const P1 = 'https://a.example/?bv=';
  const P2 = 'https://b.example/?bv=';
  const cdn = 'https://cdn-fast.test/v.mp4';

  const route = () => ({
    follow: () =>
      mediaResponse({
        url: cdn,
        body: makeStream({ totalBytes: LIMITS.cdnBytesCap, onChunk: () => (t += 100) }),
      }),
  });
  const routes = { [P1 + BV]: route(), [P2 + BV]: route(), [cdn]: route() };

  const { fetchImpl } = makeFetch(routes, {
    onCall: (url, init) => {
      if (init.redirect === 'manual') t += 120; // 解析站 302 延迟
      else t += 20; // 跟跳 + 首包
    },
  });

  const entries = [
    { type: 'bv', value: P1, note: '后海线路' },
    { type: 'bv', value: P2, note: '纯K线路' },
    { type: 'bv', value: '', note: '复制BV号' },
  ];

  const result = await runSpeedTest({ entries, bv: BV, depth: 'quick', fetchImpl, now: clock });

  const quickRounds = SPEED_DEPTHS.quick.rounds;
  assert.equal(result.rounds, quickRounds, `快速档 = ${quickRounds} 轮`);
  assert.equal(result.summary.lines, 3);
  assert.equal(result.summary.testable, 2, '空前缀那条不该被联网测试');
  assert.equal(result.summary.ok, 2);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.durationMs >= 0, true);

  const skipped = result.lines[2];
  assert.equal(skipped.state, 'skipped');
  assert.equal(skipped.grade, 'skipped');

  const lineA = result.lines[0];
  assert.equal(lineA.state, 'ok');
  assert.equal(lineA.note, '后海线路');
  assert.equal(lineA.redirect, true, '解析站给了 302');
  assert.ok(lineA.latencyMs >= 120, `302 延迟应包含探测耗时，实际 ${lineA.latencyMs}`);
  assert.equal(lineA.samples.length, quickRounds, `${quickRounds} 轮 = ${quickRounds} 个样本`);
  assert.deepEqual(lineA.hosts, ['cdn-fast.test']);
  assert.equal(lineA.cdn.length, 1);
  // 每轮都落在这个节点上 → 出现次数 = 轮数，概率 100%
  assert.equal(lineA.cdn[0].hits, quickRounds, '每轮都落到同一个节点');
  assert.equal(lineA.cdn[0].pct, 100, '只有一个节点时概率是 100%');
  assert.equal(lineA.hits, quickRounds, '成功样本总数');
  assert.ok(lineA.bestCdn.mbps >= 6, `快节点应 >= 6 MB/s，实际 ${lineA.bestCdn.mbps}`);
  assert.equal(lineA.grade, 'great');

  // 两条线路落在同一个 CDN 上，只量一次
  const lineB = result.lines[1];
  assert.deepEqual(lineB.cdn, lineA.cdn, '同一主机共用一次测量');
  assert.equal(result.summary.bestHost, 'cdn-fast.test');
  assert.equal(result.notes.length, 0);
});

test('轮换型解析站：每个 CDN 都展开，并算出出现概率', async () => {
  let t = 0;
  const clock = () => t;

  const P1 = 'https://rotate.example/?bv=';
  const cdnA = 'https://cdn-a.test/v.mp4';
  const cdnB = 'https://cdn-b.test/v.mp4';

  // 三次解析轮流落到 A、B、A —— 模拟 91vrchat 那种会在多个节点间轮换的站。
  const order = [cdnA, cdnB, cdnA];
  let call = 0;
  const routes = {
    [P1 + BV]: {
      follow: () => {
        const url = order[call++ % order.length];
        return mediaResponse({
          url,
          body: makeStream({ totalBytes: LIMITS.cdnBytesCap, onChunk: () => (t += 100) }),
        });
      },
    },
    // 两个节点都要能单独量（CDN 去重后每个只量一次）
    [cdnA]: {
      follow: () =>
        mediaResponse({
          url: cdnA,
          body: makeStream({ totalBytes: LIMITS.cdnBytesCap, onChunk: () => (t += 100) }),
        }),
    },
    [cdnB]: {
      follow: () =>
        mediaResponse({
          url: cdnB,
          body: makeStream({ totalBytes: LIMITS.cdnBytesCap, onChunk: () => (t += 500) }),
        }),
    },
  };
  const { fetchImpl } = makeFetch(routes, {
    onCall: (url, init) => {
      if (init.redirect === 'manual') t += 80;
      else t += 30;
    },
  });

  const entries = [{ type: 'bv', value: P1, note: '轮换线路' }];
  const result = await runSpeedTest({ entries, bv: BV, depth: 'quick', fetchImpl, now: clock });
  const line = result.lines[0];

  assert.equal(line.state, 'ok');
  assert.equal(line.hosts.length, 2, '两轮落 A、一轮落 B → 两个节点都该出现');
  assert.equal(line.hits, SPEED_DEPTHS.quick.rounds, '成功样本总数 = 轮数');

  const [first, second] = line.cdn;
  assert.equal(first.host, 'cdn-a.test', '出现次数多的排前面');
  assert.equal(first.hits, 2);
  assert.equal(first.pct, 67, '2/3 ≈ 67%');
  assert.equal(second.host, 'cdn-b.test');
  assert.equal(second.hits, 1);
  assert.equal(second.pct, 33, '1/3 ≈ 33%');

  // 两个节点各量一次，A 快、B 慢
  assert.ok(first.mbps > second.mbps, `A 应比 B 快：A=${first.mbps} B=${second.mbps}`);
  assert.equal(line.bestCdn.host, 'cdn-a.test', '最快节点是 A');
  assert.equal(first.error, '');
  assert.equal(second.error, '');
});

test('慢节点：速率低就被评为偏慢', async () => {
  let t = 0;
  const clock = () => t;
  const P = 'https://slow.example/?bv=';
  const cdn = 'https://cdn-slow.test/v.mp4';
  const routes = {
    [P + BV]: {
      follow: () =>
        mediaResponse({
          url: cdn,
          body: makeStream({ totalBytes: LIMITS.cdnBytesCap, onChunk: () => (t += 900) }),
        }),
    },
    [cdn]: {
      follow: () =>
        mediaResponse({
          url: cdn,
          body: makeStream({ totalBytes: LIMITS.cdnBytesCap, onChunk: () => (t += 900) }),
        }),
    },
  };
  const { fetchImpl } = makeFetch(routes, { onCall: () => {} });
  const result = await runSpeedTest({
    entries: [{ type: 'bv', value: P, note: '慢线' }],
    bv: BV,
    depth: 'quick',
    fetchImpl,
    now: clock,
  });
  const line = result.lines[0];
  assert.equal(line.state, 'ok');
  assert.ok(line.bestCdn.mbps < 3, `慢节点速率应偏低，实际 ${line.bestCdn.mbps}`);
  assert.ok(['fair', 'slow', 'bad'].includes(line.grade), `评级应偏低，实际 ${line.grade}`);
});

test('解析站直出（没有 302）也能算出 CDN 主机', async () => {
  const clock = () => 0;
  const P = 'https://direct.example/?bv=';
  const cdn = 'https://upos-sz-estgoss.bilivideo.com/x.mp4';
  const direct = () =>
    mediaResponse({ url: cdn, redirected: false, body: makeStream({ totalBytes: LIMITS.cdnBytesCap }) });
  const routes = {
    [P + BV]: {
      manual: { type: 'basic', status: 200, url: P + BV, headers: new Headers() },
      follow: direct,
    },
    [cdn]: { follow: direct },
  };
  const { fetchImpl } = makeFetch(routes, { onCall: () => {} });
  const result = await runSpeedTest({
    entries: [{ type: 'bv', value: P, note: '' }],
    bv: BV,
    depth: 'quick',
    fetchImpl,
    now: clock,
  });
  const line = result.lines[0];
  assert.equal(line.state, 'ok');
  assert.equal(line.redirect, false, '解析站直接 200，没有跳转');
  assert.equal(line.samples[0].redirected, false);
  assert.deepEqual(line.hosts, ['upos-sz-estgoss.bilivideo.com']);
});

test('解析站吐网页 / 健康检查页时不算 CDN 节点', async () => {
  const clock = () => 0;
  const P = 'https://page.example/?bv=';
  const url = P + BV;
  const routes = {
    // 有些站忙的时候会回 200 + 一个网页，而不是 302
    [url]: {
      manual: { type: 'basic', status: 200, url, headers: new Headers({ 'content-type': 'text/html' }) },
      follow: () =>
        mediaResponse({
          url,
          status: 200,
          redirected: false,
          headers: { 'content-type': 'text/html' },
          body: makeStream({ totalBytes: 2, chunkBytes: 2 }),
        }),
    },
  };
  const { fetchImpl } = makeFetch(routes, { onCall: () => {} });
  const result = await runSpeedTest({
    entries: [{ type: 'bv', value: P, note: '纯K线路' }],
    bv: BV,
    depth: 'quick',
    fetchImpl,
    now: clock,
  });
  const line = result.lines[0];
  assert.equal(line.state, 'fail');
  assert.deepEqual(line.hosts, [], '解析站自己的域名不该当成 CDN');
  assert.equal(line.cdn.length, 0);
  assert.equal(line.grade, 'fail');
  assert.match(line.reason, /没有跳到视频地址/);
});

test('连不上的线路：标记失败并给出原因，不影响其他线路', async () => {
  const clock = () => 0;
  const good = 'https://good.example/?bv=';
  const bad = 'https://bad.example/?bv=';
  const http = 'http://plain-http.example/?bv=';
  const cdn = 'https://cdn.test/v.mp4';
  const routes = {
    [good + BV]: { follow: () => mediaResponse({ url: cdn, body: makeStream({ totalBytes: LIMITS.cdnBytesCap }) }) },
    [cdn]: { follow: () => mediaResponse({ url: cdn, body: makeStream({ totalBytes: LIMITS.cdnBytesCap }) }) },
    [bad + BV]: { throw: 'Failed to fetch' },
    [http + BV]: { throw: 'Failed to fetch' },
  };
  const { fetchImpl, calls } = makeFetch(routes, { onCall: () => {} });
  const result = await runSpeedTest({
    entries: [
      { type: 'bv', value: good, note: '好线路' },
      { type: 'bv', value: bad, note: '坏线路' },
      { type: 'bv', value: http, note: '纯K线路' },
    ],
    bv: BV,
    depth: 'quick',
    fetchImpl,
    now: clock,
  });

  assert.equal(result.summary.ok, 1);
  assert.equal(result.summary.failed, 2);
  assert.equal(result.lines[1].state, 'fail');
  assert.match(result.lines[1].reason, /网络错误/);
  assert.equal(result.lines[1].grade, 'fail');
  assert.equal(result.lines[2].state, 'fail');
  assert.equal(result.notes.length, 1, 'http:// 线路失败时应提示改 https');
  assert.match(result.notes[0], /https/);
  assert.equal(calls.filter((call) => call.redirect === 'manual').length, 3, '每条线路都先探 302');
});

test('样本太小时不给速率，但线路仍算通', async () => {
  const clock = () => 0;
  const P = 'https://small.example/?bv=';
  const cdn = 'https://cdn-small.test/v.mp4';
  const tiny = () => mediaResponse({ url: cdn, body: makeStream({ totalBytes: 8 * 1024, chunkBytes: 8 * 1024 }) });
  const routes = { [P + BV]: { follow: tiny }, [cdn]: { follow: tiny } };
  const { fetchImpl } = makeFetch(routes, { onCall: () => {} });
  const result = await runSpeedTest({
    entries: [{ type: 'bv', value: P, note: '' }],
    bv: BV,
    depth: 'quick',
    fetchImpl,
    now: clock,
  });
  const line = result.lines[0];
  assert.equal(line.state, 'ok');
  assert.equal(line.bestCdn, null);
  assert.equal(line.grade, 'unknown');
  assert.match(line.cdn[0].error, /样本太小/);
});

test('所有线路都挂掉时给出总体提示', async () => {
  const clock = () => 0;
  const { fetchImpl } = makeFetch({}, { onCall: () => {} });
  const result = await runSpeedTest({
    entries: [{ type: 'bv', value: 'https://x.example/?bv=', note: '' }],
    bv: BV,
    depth: 'quick',
    fetchImpl,
    now: clock,
  });
  assert.equal(result.summary.ok, 0);
  assert.equal(result.lines[0].state, 'fail');
  assert.ok(result.notes.some((note) => note.includes('所有线路')));
});

test('支持外部取消：abort 后不再继续探测', async () => {
  const clock = () => 0;
  const controller = new AbortController();
  const P = 'https://abort.example/?bv=';
  const cdn = 'https://cdn.test/v.mp4';
  const routes = {
    [P + BV]: { follow: () => mediaResponse({ url: cdn, body: makeStream({ totalBytes: LIMITS.cdnBytesCap }) }) },
    [cdn]: { follow: () => mediaResponse({ url: cdn, body: makeStream({ totalBytes: LIMITS.cdnBytesCap }) }) },
  };
  const { fetchImpl } = makeFetch(routes, { onCall: () => {} });
  controller.abort();
  const result = await runSpeedTest({
    entries: [{ type: 'bv', value: P, note: '' }],
    bv: BV,
    depth: 'deep',
    fetchImpl,
    now: clock,
    signal: controller.signal,
  });
  assert.equal(result.lines[0].samples.length, 0, 'abort 后不再产生样本');
});


test('JSON 接口线路：从 JSON 里读直链，再按 CDN 计速率', async () => {
  let t = 0;
  const clock = () => t;
  const apiUrl = probeUrlFor({ type: 'api', value: 'https://api.squidtail.com/bili2vrc/parse/' }, BV);
  const cdn = 'https://upos-hz-mirrorakam.akamaized.net/upgcxcode/02/94/364849402/v.mp4?deadline=1';
  const apiResponse = () => ({
    url: apiUrl,
    status: 200,
    ok: true,
    redirected: false,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: null,
    json: async () => ({ code: 0, quality: 64, url: cdn }),
  });
  const { fetchImpl, calls } = makeFetch({
    [apiUrl]: { follow: apiResponse },
    [cdn]: {
      follow: () =>
        mediaResponse({
          url: cdn,
          body: makeStream({
            totalBytes: LIMITS.cdnBytesCap,
            onChunk: () => {
              t += 40;
            },
          }),
        }),
    },
  });

  const result = await runSpeedTest({
    entries: [{ type: 'api', value: 'https://api.squidtail.com/bili2vrc/parse/', note: 'Bili2VRC' }],
    bv: BV,
    depth: 'quick',
    fetchImpl,
    now: clock,
  });

  const line = result.lines[0];
  assert.equal(line.state, 'ok');
  assert.equal(line.redirect, cdn, '拿到的是 JSON 里的直链');
  assert.equal(line.cdn.length, 1);
  assert.equal(line.cdn[0].host, 'upos-hz-mirrorakam.akamaized.net');
  assert.equal(line.cdn[0].pct, 100);
  assert.equal(line.cdn[0].ttfbMs !== null, true);
  assert.equal(calls.some((call) => call.url === apiUrl), true);
});
