/**
 * 线路测速：拿一个测试 BV 号，把配置里的每条解析线路跑一遍。
 *
 * 每条线路测三件事（对应「播放体验」的三个环节）：
 * 1. 解析站 302 延迟：`redirect: 'manual'` 只拿到 302 就停，不产生 CDN 流量。
 * 2. 解析出来的最终地址：`redirect: 'follow'` 跟一次 302，记录落到哪个 CDN 主机；
 *    多跑几轮，把「同一个 BV 在这个出口 IP 下可能被分到的节点」尽量探全。
 * 3. CDN 首包 + 下载速率：去重后每个 CDN 主机只量一次，`Range: bytes=0-3MB`，
 *    最多读 2 秒，够算速率又不至于把 CDN 打疼。
 *
 * 负载控制（用户要求：别等太久、也别太暴力）：
 * - 线路之间并行、同一条线路内部串行并留 500ms 间隔，等于把请求摊开在几秒里；
 * - 单次请求都有超时，单条线路还有总预算，任何一步卡住都不会拖死整个测速；
 * - CDN 去重后最多 4 个并发，每个主机最多 3MB / 2 秒。
 */
import { applyPrefix } from './bili.js';
import { buildApiUrl } from './api.js';
import { ENTRY_TYPE_API, ENTRY_TYPE_AUTO, ENTRY_TYPE_BV, entryHostHint } from './settings.js';

/** 默认测试 BV（几个解析站都能解析的那条）。 */
export const DEFAULT_TEST_BV = 'BV1AM4y1M71p';

export const SPEED_DEPTHS = {
  quick: { label: '快速 · 3 轮', rounds: 3 },
  // 会轮换的站（91vrchat / ckapi）只有多打几轮才看得到全部节点；
  // 不轮换的站连续 4 轮落同一个节点就早停，所以轮次加多并不会拖慢它们。
  // 标准档定在 6 轮：节点抽样够全，又不会像 10 轮那样把总时长拖到 20 秒以上；
  // 想穷举一个站的轮换范围用「深入」（10 轮，约 30 秒，轮换型站点会测满）。
  normal: { label: '标准 · 6 轮', rounds: 6 },
  deep: { label: '深入 · 10 轮', rounds: 10 },
};
export const DEFAULT_DEPTH = 'normal';
export const DEFAULT_SPEED_CONFIG = { bv: DEFAULT_TEST_BV, depth: DEFAULT_DEPTH };

/** 各项预算，集中放这里方便调。 */
export const LIMITS = {
  probeTimeoutMs: 5000,
  followTimeoutMs: 8000,
  // 单条线路的总时长预算。放宽到 18 秒，是为了让 chiooone 这类 3 秒才回 302 的站
  // 也能测满轮次，从而看清它到底会在几个 CDN 之间轮换。
  lineBudgetMs: 18000,
  // 连续这么多轮都落在同一个节点上才早停（轮换型站点会测满轮次）。
  // 从 2 提到 4：2 轮就停会把「A A B」这种刚开始轮换的站误判成固定节点。
  stableRounds: 4,
  cdnTimeoutMs: 7000,
  cdnBytesCap: 3 * 1024 * 1024,
  cdnTimeCapMs: 2000,
  cdnConcurrency: 4,
  // 解析还没跑完时，先把已经拿到的节点低声量地量起来（把测速藏在解析后面）。
  cdnWarmConcurrency: 2,
  gapMs: 600,
  /** 少于这个字节数的下载样本不足以算速率。 */
  cdnMinBytes: 128 * 1024,
};

const MB = 1024 * 1024;

/** 评级：图标 + 文案，UI 直接取用。 */
export const GRADES = {
  great: { icon: '⚡', label: '极佳', tone: 'great' },
  good: { icon: '🟢', label: '良好', tone: 'good' },
  fair: { icon: '🟡', label: '可用', tone: 'fair' },
  slow: { icon: '🟠', label: '偏慢', tone: 'slow' },
  bad: { icon: '🔴', label: '很慢', tone: 'bad' },
  fail: { icon: '⛔', label: '失败', tone: 'fail' },
  unknown: { icon: '❔', label: '未知', tone: 'unknown' },
  skipped: { icon: '➖', label: '不联网', tone: 'skipped' },
};

/** 下载速率（MB/s）→ 评级。阈值按「够不够放 1080p」来定。 */
export function gradeSpeed(mbps) {
  if (!Number.isFinite(mbps) || mbps <= 0) return 'unknown';
  if (mbps >= 6) return 'great';
  if (mbps >= 3) return 'good';
  if (mbps >= 1.2) return 'fair';
  if (mbps >= 0.5) return 'slow';
  return 'bad';
}

/** 首包 / 302 延迟（毫秒）→ 评级。 */
export function gradeLatency(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  if (ms <= 400) return 'great';
  if (ms <= 900) return 'good';
  if (ms <= 2000) return 'fair';
  return 'slow';
}

export function formatMbps(mbps) {
  if (!Number.isFinite(mbps)) return '—';
  if (mbps >= 10) return `${mbps.toFixed(1)} MB/s`;
  if (mbps >= 1) return `${mbps.toFixed(2)} MB/s`;
  return `${Math.round(mbps * 1024)} KB/s`;
}

export function formatMs(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}

/** 这一条线路对测试 BV 实际会请求的地址（空前缀 = 不联网，返回空串）。 */
export function probeUrlFor(entry, bv) {
  const value = typeof entry?.value === 'string' ? entry.value : '';
  if (!value.trim()) return '';
  // JSON 接口：把参数直接拼进接口地址，扩展自己取 JSON 里的直链。
  if (entry?.type === ENTRY_TYPE_API) return buildApiUrl(value, bv, 1);
  const target = entry?.type === ENTRY_TYPE_BV ? bv : `https://www.bilibili.com/video/${bv}`;
  return applyPrefix(value, target) || target;
}

/** 从 URL 取主机名。 */
export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * 跑一轮测速。
 *
 * @param {object} options
 * @param {{type:string,value:string,note:string}[]} options.entries 当前配置
 * @param {string} options.bv 测试 BV 号
 * @param {'quick'|'normal'|'deep'} options.depth 探测轮次
 * @param {typeof fetch} [options.fetchImpl] 便于测试注入
 * @param {() => number} [options.now] 便于测试注入（毫秒时钟）
 * @param {AbortSignal} [options.signal] 取消
 * @param {(evt: object) => void} [options.onProgress] 进度回调
 */
export async function runSpeedTest({
  entries = [],
  bv = DEFAULT_TEST_BV,
  depth = DEFAULT_DEPTH,
  fetchImpl = null,
  now = null,
  signal = null,
  onProgress = () => {},
} = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('当前环境没有 fetch，无法测速');
  const clock = now || defaultClock();
  const rounds = (SPEED_DEPTHS[depth] || SPEED_DEPTHS.normal).rounds;

  const startedAt = new Date().toISOString();
  const startedMs = clock();
  const ctx = { doFetch, clock, signal, noteHost: () => {} };

  const lines = entries.map((entry, index) => {
    const url = probeUrlFor(entry, bv);
    const note = typeof entry?.note === 'string' ? entry.note.trim() : '';
    return {
      index,
      type: entry?.type || '',
      note,
      host: entryHostHint(entry),
      value: typeof entry?.value === 'string' ? entry.value : '',
      url,
      state: url ? 'pending' : 'skipped',
      reason: url
        ? ''
        : entry?.type === ENTRY_TYPE_AUTO
          ? '智能条目，不参与测速'
          : '空前缀，只在本地复制，不联网',
      latencyMs: null,
      redirect: null,
      samples: [],
      hosts: [],
      cdn: [],
      bestCdn: null,
      grade: url ? 'unknown' : 'skipped',
    };
  });

  const testable = lines.filter((line) => line.state !== 'skipped');
  let resolveDone = 0;
  onProgress({ phase: 'resolve', done: 0, total: testable.length, lines });

  // 所有线路见过的 CDN 主机（去重后每个只量一次）。解析阶段就在往里塞，边塞边量。
  const hostMap = new Map();
  const cdnQueue = [];
  let cdnRunning = 0;
  let cdnLimit = LIMITS.cdnWarmConcurrency;
  let cdnTotal = 0;
  let cdnDone = 0;
  let cdnIdle = null;

  function noteHost(sample, lineIndex) {
    if (!sample?.ok || !sample.finalHost || signal?.aborted) return;
    const host = sample.finalHost;
    let item = hostMap.get(host);
    if (!item) {
      item = {
        host,
        url: sample.finalUrl,
        direct: Boolean(sample.direct),
        lineIndexes: [],
        mbps: null,
        ttfbMs: null,
        bytes: 0,
        error: '',
        drained: 'queued',
      };
      hostMap.set(host, item);
      cdnQueue.push(item);
      cdnTotal += 1;
      pumpCdn();
    }
    if (!item.lineIndexes.includes(lineIndex)) item.lineIndexes.push(lineIndex);
    // 同一个 host 被不同线路解析出来时，优先用真正跳转出的地址（而不是解析站直出的）。
    if (item.drained === 'queued' && (!item.url || (item.direct && !sample.direct))) {
      item.url = sample.finalUrl;
      item.direct = Boolean(sample.direct);
    }
  }

  function pumpCdn() {
    while (cdnRunning < cdnLimit && cdnQueue.length) {
      const item = cdnQueue.shift();
      item.drained = 'running';
      cdnRunning += 1;
      measureCdn(item.url, ctx)
        .then((measured) => {
          item.mbps = measured.mbps;
          item.ttfbMs = measured.ttfbMs;
          item.bytes = measured.bytes;
          item.error = measured.error;
        })
        .catch((error) => {
          item.error = describeError(error);
        })
        .finally(() => {
          item.drained = 'done';
          cdnRunning -= 1;
          cdnDone += 1;
          onProgress({ phase: 'cdn', done: cdnDone, total: cdnTotal, lines });
          pumpCdn();
          if (!cdnRunning && !cdnQueue.length && cdnIdle) {
            const done = cdnIdle;
            cdnIdle = null;
            done();
          }
        });
    }
  }

  function drainCdn() {
    if (!cdnRunning && !cdnQueue.length) return Promise.resolve();
    return new Promise((resolve) => {
      cdnIdle = resolve;
    });
  }

  ctx.noteHost = noteHost;

  await Promise.all(
    testable.map(async (line) => {
      line.state = 'running';
      onProgress({ phase: 'resolve', done: resolveDone, total: testable.length, lines });
      try {
        await probeLine(line, ctx, rounds);
      } catch (error) {
        line.state = 'fail';
        line.reason = describeError(error);
      }
      resolveDone += 1;
      onProgress({ phase: 'resolve', done: resolveDone, total: testable.length, lines });
    }),
  );

  // CDN 节点去重表 + 队列：解析阶段一拿到新节点就排队量，把 CDN 测速藏在解析的尾巴后面，
  // 整体等待时间少 3~5 秒；信号量保证同一时刻不会打太多节点（解析时 2 个，解析完放宽到 4 个）。
  cdnLimit = LIMITS.cdnConcurrency;
  pumpCdn();
  if (cdnTotal) onProgress({ phase: 'cdn', done: cdnDone, total: cdnTotal, lines });
  await drainCdn();

  for (const line of lines) finalizeLine(line, hostMap);

  const finishedMs = clock();
  const okLines = lines.filter((line) => line.state === 'ok');
  const best = [...hostMap.values()]
    .filter((item) => Number.isFinite(item.mbps))
    .sort((a, b) => b.mbps - a.mbps)[0] || null;

  const result = {
    version: 1,
    bv,
    depth,
    rounds,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(finishedMs - startedMs),
    lines: lines.map(serializeLine),
    summary: {
      lines: lines.length,
      testable: testable.length,
      ok: okLines.length,
      failed: testable.length - okLines.length,
      bestHost: best ? best.host : '',
      bestMbps: best && Number.isFinite(best.mbps) ? Number(best.mbps.toFixed(2)) : null,
    },
    notes: buildNotes(lines),
  };
  onProgress({ phase: 'done', done: 1, total: 1, lines, result });
  return result;
}

/* ------------------------------------------------------------------ *
 * 单条线路
 * ------------------------------------------------------------------ */

async function probeLine(line, ctx, rounds) {
  const { clock, signal } = ctx;
  const lineDeadline = clock() + LIMITS.lineBudgetMs;

  const isApi = line.type === ENTRY_TYPE_API;
  const first = isApi ? await measureApi(line.url, ctx) : await measure302(line.url, ctx);
  line.latencyMs = first.ok ? first.ms : null;
  line.redirect = first.redirect;
  if (!first.ok) line.reason = first.error || '解析站没有响应';

  const seenHosts = new Set();
  for (let i = 0; i < rounds; i += 1) {
    if (signal?.aborted) break;
    if (clock() > lineDeadline) {
      line.samples.push(failedSample(`超出单条线路 ${Math.round(LIMITS.lineBudgetMs / 1000)} 秒预算`));
      break;
    }
    const sample = isApi ? await followApiSample(line.url, ctx) : await followSample(line.url, ctx);
    line.samples.push(sample);
    if (sample.ok && sample.finalHost) seenHosts.add(sample.finalHost);
    // 节点一出现就排进 CDN 队列：解析还在跑第 2、3 轮时，第一个节点已经在量了。
    ctx.noteHost(sample, line.index);

    // 自适应早停：已经拿到 2 轮、且两轮都落在同一个节点上，说明这个站不怎么轮换，
    // 再测只是多花 2~3 秒，不增加信息量。会轮换的站（两轮就出现多个节点）照常测满。
    const okSamples = line.samples.filter((item) => item.ok).length;
    if (okSamples >= LIMITS.stableRounds && seenHosts.size <= 1) {
      line.stable = true;
      break;
    }
    if (i < rounds - 1) await delay(LIMITS.gapMs, signal);
  }

  const okSamples = line.samples.filter((sample) => sample.ok);
  line.state = okSamples.length ? 'ok' : 'fail';
  if (!okSamples.length && !line.reason) {
    line.reason = line.samples.find((sample) => sample.error)?.error || '没有拿到可播放地址';
  }
  line.hosts = [...new Set(okSamples.map((sample) => sample.finalHost).filter(Boolean))];
  if (line.state === 'ok' && line.redirect === false && !line.hosts.length) {
    line.reason = line.reason || '解析站没有返回跳转';
  }
}

/** 只拿 302：redirect: 'manual' 不会跟着跳到 CDN，所以这一步不产生视频流量。 */
async function measure302(url, { doFetch, clock, signal }) {
  const guard = withTimeout(signal, LIMITS.probeTimeoutMs);
  const started = clock();
  try {
    const response = await doFetch(url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'omit',
      signal: guard.signal,
    });
    const ms = clock() - started;
    const redirected =
      response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);
    cancelBody(response);
    if (!redirected && response.status >= 400) {
      // 5xx 多半是「这个 BV 它解析不了」（xuan25 会回 500 + `CID Error: 啥都木有`），
      // 4xx 更像风控/限流；两种都提示一句，免得以为是线路挂了。
      const hint =
      response.status === 567
        ? '，B 站在临时限流，过几分钟再测'
        : response.status >= 500
          ? '，多半是这个 BV 号它解析不了'
          : '';
      return { ok: false, ms, redirect: false, error: `解析站返回 HTTP ${response.status}${hint}` };
    }
    return { ok: true, ms, redirect: redirected, error: '' };
  } catch (error) {
    return { ok: false, ms: clock() - started, redirect: null, error: describeError(error, guard) };
  } finally {
    guard.done();
  }
}

/** JSON 接口的「解析延迟」：一次请求拿到 JSON 里的直链用了多久。 */
async function measureApi(url, { doFetch, clock, signal }) {
  const guard = withTimeout(signal, LIMITS.probeTimeoutMs);
  const started = clock();
  try {
    const response = await doFetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      signal: guard.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    const ms = clock() - started;
    if (!response.ok) {
      return { ok: false, ms, redirect: null, error: `解析接口返回 HTTP ${response.status}` };
    }
    const data = await response.json().catch(() => null);
    const target = typeof data?.url === 'string' ? data.url.trim() : '';
    if (!target) {
      const message = typeof data?.message === 'string' && data.message ? data.message : '解析接口没有返回 url';
      return { ok: false, ms, redirect: null, error: message };
    }
    return { ok: true, ms, redirect: target, error: '' };
  } catch (error) {
    return { ok: false, ms: clock() - started, redirect: null, error: describeError(error, guard) };
  } finally {
    guard.done();
  }
}

/** JSON 接口的一轮抽样：请求 → 读 JSON → 把里面的直链当作最终地址。 */
async function followApiSample(url, { doFetch, clock, signal }) {
  const guard = withTimeout(signal, LIMITS.followTimeoutMs);
  const started = clock();
  try {
    const response = await doFetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      signal: guard.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    const ms = clock() - started;
    if (!response.ok) {
      return { ...failedSample(`解析接口返回 HTTP ${response.status}`), ms };
    }
    const data = await response.json().catch(() => null);
    const target = typeof data?.url === 'string' ? data.url.trim() : '';
    if (!target) {
      const message = typeof data?.message === 'string' && data.message ? data.message : '解析接口没有返回 url';
      return { ...failedSample(message), ms };
    }
    return {
      ok: true,
      ms,
      status: response.status,
      finalUrl: target,
      finalHost: hostOf(target),
      contentType: 'video/mp4',
      redirected: true,
      direct: true,
      quality: Number.isFinite(data?.quality) ? data.quality : null,
      error: '',
    };
  } catch (error) {
    return { ...failedSample(describeError(error, guard)), ms: clock() - started };
  } finally {
    guard.done();
  }
}

/** 跟一次 302，记录最终地址与「解析 + CDN 首包」总耗时；拿到响应头就断开，不下载。 */
async function followSample(url, { doFetch, clock, signal }) {
  const guard = withTimeout(signal, LIMITS.followTimeoutMs);
  const started = clock();
  try {
    const response = await doFetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      signal: guard.signal,
      headers: { Range: 'bytes=0-0' },
    });
    const ms = clock() - started;
    const finalUrl = response.url || url;
    const status = response.status;
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const redirected = Boolean(response.redirected);
    cancelBody(response);
    const finalHost = hostOf(finalUrl);
    // 没有跳转、并且落回解析站自己的域名：多半是解析站吐了个网页 / 健康检查页
    // （ckapi 忙的时候就回过 2 字节的 “ok”），这种地址拿去量 CDN 没有意义。
    if (!redirected && finalHost && finalHost === hostOf(url)) {
      return {
        ok: false,
        ms,
        status,
        finalUrl,
        finalHost: '',
        contentType,
        redirected,
        direct: true,
        error: `解析站直接返回了内容（HTTP ${status}），没有跳到视频地址`,
      };
    }
    const ok = status >= 200 && status < 400;
    return {
      ok,
      ms,
      status,
      finalUrl,
      finalHost,
      contentType,
      redirected,
      direct: !redirected,
      error: ok ? '' : `CDN 返回 HTTP ${status}`,
    };
  } catch (error) {
    return { ...failedSample(describeError(error, guard)), ms: clock() - started };
  } finally {
    guard.done();
  }
}

function failedSample(error) {
  return {
    ok: false,
    ms: 0,
    status: 0,
    finalUrl: '',
    finalHost: '',
    contentType: '',
    redirected: false,
    direct: false,
    error,
  };
}

/** 量一个 CDN 主机的首包与下载速率。 */
async function measureCdn(url, { doFetch, clock, signal }) {
  const guard = withTimeout(signal, LIMITS.cdnTimeoutMs);
  const started = clock();
  let ttfbMs = null;
  let bytes = 0;
  try {
    const response = await doFetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      signal: guard.signal,
      headers: { Range: `bytes=0-${LIMITS.cdnBytesCap - 1}` },
    });
    ttfbMs = clock() - started;
    if (response.status >= 400) throw new Error(`CDN 返回 HTTP ${response.status}`);

    const body = response.body;
    if (!body || typeof body.getReader !== 'function') {
      const buffer = await response.arrayBuffer();
      bytes = buffer.byteLength;
    } else {
      const reader = body.getReader();
      const deadline = clock() + LIMITS.cdnTimeCapMs;
      while (bytes < LIMITS.cdnBytesCap) {
        if (clock() >= deadline) {
          try {
            await reader.cancel();
          } catch {
            /* 忽略 */
          }
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value?.byteLength || 0;
      }
    }

    const nowMs = clock();
    const bodyMs = Math.max(nowMs - started - (ttfbMs || 0), 60);
    if (bytes < LIMITS.cdnMinBytes) {
      return {
        ttfbMs,
        bytes,
        mbps: null,
        error: bytes > 0 ? `样本太小（${formatBytes(bytes)}）` : '没有拿到数据',
      };
    }
    return { ttfbMs, bytes, mbps: bytes / MB / (bodyMs / 1000), error: '' };
  } catch (error) {
    return { ttfbMs, bytes, mbps: null, error: describeError(error, guard) };
  } finally {
    guard.done();
  }
}

function finalizeLine(line, hostMap) {
  // 统计每个节点在这条线路的所有成功样本里出现了几次 —— 这就是它的「出现概率」。
  const hits = new Map();
  for (const sample of line.samples) {
    if (!sample.ok || !sample.finalHost) continue;
    hits.set(sample.finalHost, (hits.get(sample.finalHost) || 0) + 1);
  }
  const totalHits = [...hits.values()].reduce((sum, n) => sum + n, 0);

  line.hits = totalHits;
  line.cdn = line.hosts
    .map((host) => hostMap.get(host))
    .filter(Boolean)
    .map((item) => {
      const count = hits.get(item.host) || 0;
      return {
        host: item.host,
        mbps: Number.isFinite(item.mbps) ? Number(item.mbps.toFixed(3)) : null,
        ttfbMs: Number.isFinite(item.ttfbMs) ? Math.round(item.ttfbMs) : null,
        bytes: item.bytes || 0,
        direct: Boolean(item.direct),
        error: item.error || '',
        hits: count,
        pct: totalHits ? Math.round((count / totalHits) * 100) : null,
      };
    });

  // 节点按出现次数排序，抽查最多的排前面，方便一眼看出主力节点。
  line.cdn.sort((a, b) => b.hits - a.hits);

  const measured = line.cdn
    .filter((item) => Number.isFinite(item.mbps))
    .sort((a, b) => b.mbps - a.mbps);
  line.bestCdn = measured.length ? measured[0] : null;

  if (line.state === 'skipped') {
    line.grade = 'skipped';
  } else if (line.state !== 'ok') {
    line.grade = 'fail';
  } else if (line.bestCdn) {
    line.grade = gradeSpeed(line.bestCdn.mbps);
  } else {
    line.grade = 'unknown';
  }
}

function serializeLine(line) {
  return {
    index: line.index,
    note: line.note,
    host: line.host,
    value: line.value,
    url: line.url,
    state: line.state,
    reason: line.reason,
    latencyMs: Number.isFinite(line.latencyMs) ? Math.round(line.latencyMs) : null,
    redirect: line.redirect,
    grade: line.grade,
    hosts: [...line.hosts],
    hits: Number.isFinite(line.hits) ? line.hits : null,
    samples: line.samples.map((sample) => ({
      ok: Boolean(sample.ok),
      ms: Math.round(sample.ms || 0),
      status: sample.status || 0,
      finalUrl: sample.finalUrl || '',
      finalHost: sample.finalHost || '',
      redirected: Boolean(sample.redirected),
      error: sample.error || '',
    })),
    cdn: line.cdn,
    bestCdn: line.bestCdn,
  };
}

function buildNotes(lines) {
  const notes = [];
  const failedHttp = lines.filter(
    (line) => line.state === 'fail' && /^http:\/\//i.test(line.url || ''),
  );
  if (failedHttp.length) {
    notes.push(
      `有 ${failedHttp.length} 条 http:// 线路没测通；浏览器可能拦截了 http 请求，把它们改成 https:// 再测一次。`,
    );
  }
  if (lines.length && !lines.some((line) => line.state === 'ok')) {
    notes.push('所有线路都没测通，先确认本机网络能不能正常打开 B 站。');
  }
  return notes;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function defaultClock() {
  const perf = globalThis.performance;
  if (perf && typeof perf.now === 'function') return () => perf.now();
  return () => Date.now();
}

function cancelBody(response) {
  try {
    if (response?.body && typeof response.body.cancel === 'function') {
      response.body.cancel().catch(() => {});
    }
  } catch {
    /* 忽略 */
  }
}

/** 带超时的 AbortSignal：外部取消与本地超时都能打断请求。 */
function withTimeout(signal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    },
  };
}

function describeError(error, guard) {
  if (guard && typeof guard.timedOut === 'function' && guard.timedOut()) return '超时';
  const name = String(error?.name || '');
  if (name === 'AbortError' || name === 'TimeoutError') return '超时';
  const message = String(error?.message || error || '');
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(message)) {
    return '网络错误（连不上，或被浏览器拦截）';
  }
  return message || '未知错误';
}

function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    if (signal) signal.addEventListener('abort', finish, { once: true });
  });
}

async function runPool(items, concurrency, worker) {
  if (!items.length) return;
  let cursor = 0;
  const size = Math.max(1, Math.min(concurrency, items.length));
  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}
