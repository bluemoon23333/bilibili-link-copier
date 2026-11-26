import { buildApiUrl, fetchApiTarget } from './api.js';
import { applyPrefix } from './bili.js';
import { ENTRY_TYPE_API, ENTRY_TYPE_AUTO, ENTRY_TYPE_URL } from './settings.js';
import { hostOf } from './speedtest.js';

/**
 * 「智能最快节点」条目。
 *
 * 目标：点一次就拿到一条**相对最快**的 CDN 直链，而不是只复制解析站链接。
 * 做法分两档，能省请求就省：
 *   1. 目标节点是同族 `*.bilivideo.com` 的 `/upgcxcode/` 直链 →
 *      用任意一条线路解析出 URL，直接把 host 换掉（B 站签名不绑 host），
 *      换个 1 字节验证一下即可。**只花 1 次解析请求**。
 *   2. 目标节点不是同族（akamaized / mcdn / 第三方）→ 只能找「上次测速时
 *      真的吐出这个节点的解析站」重新解析，有限次尝试；还是拿不到就退到
 *      第二快的节点。
 *
 * 所有网络请求都注入 fetch / 时钟，方便在 Node 里跑单测。
 */

/** 最多尝试几个目标节点（第一快拿不到就看第二、第三快）。 */
export const AUTO_HOST_TRIES = 3;
/** 一次点击的总预算：超过就用手上已有的地址（宁可慢一点，也不要让用户干等）。 */
export const AUTO_BUDGET_MS = 9000;
/** 单次解析站请求的超时：xuan25 冷启动实测 1.1~4.4 秒，给到 5 秒。 */
export const AUTO_RESOLVE_TIMEOUT_MS = 5000;
/** 换完 host 之后的验证超时：只取 1 字节，超过 1.2 秒就算这个节点不行。 */
export const AUTO_VERIFY_TIMEOUT_MS = 1200;
/** 解析站请求的总次数上限（含换节点重试）。 */
export const AUTO_MAX_ATTEMPTS = 6;
/** 低于这个速率的节点不值得为它换（宁可保持原地址）。 */
export const AUTO_MIN_MBPS = 0.5;

/** 同族判断：只有 `*.bilivideo.com` 的普通直链能换 host。 */
export function isBilivideoHost(host) {
  return typeof host === 'string' && /(^|\.)bilivideo\.com$/i.test(host.trim());
}

/** 能不能换 host：同族 + B 站常规直链路径（PCDN 的 /v1/resource/ 换过去会 403）。 */
export function isRewritableCdn(url) {
  if (typeof url !== 'string' || !url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isBilivideoHost(parsed.hostname) && parsed.pathname.includes('/upgcxcode/');
}

/**
 * 把 CDN 直链的 host 换掉，其余（path/query/签名）原样保留。
 * 换不了（跨族 / 非 upgcxcode / URL 非法）返回 null。
 */
export function swapCdnHost(url, host) {
  if (!isRewritableCdn(url)) return null;
  const target = typeof host === 'string' ? host.trim() : '';
  if (!target || !isBilivideoHost(target)) return null;
  try {
    const parsed = new URL(url);
    parsed.host = target;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * 把测速结果摊平成「节点排行榜」：同一个节点在多条线路里出现过就取最快的那个值。
 * @param {{lines?: Array<object>}} speedResult 上次测速结果
 * @returns {{host:string, mbps:number, ttfbMs:number|null, pct:number, fromLines:number[]}[]}
 */
export function rankCdns(speedResult) {
  const byHost = new Map();
  for (const line of speedResult?.lines || []) {
    for (const cdn of line?.cdn || []) {
      const host = typeof cdn?.host === 'string' ? cdn.host.trim() : '';
      if (!host || !Number.isFinite(cdn.mbps)) continue;
      const prev = byHost.get(host) || {
        host,
        mbps: 0,
        ttfbMs: null,
        pct: 0,
        fromLines: [],
      };
      prev.mbps = Math.max(prev.mbps, cdn.mbps);
      if (Number.isFinite(cdn.ttfbMs) && (prev.ttfbMs === null || cdn.ttfbMs < prev.ttfbMs)) {
        prev.ttfbMs = Math.round(cdn.ttfbMs);
      }
      if (Number.isFinite(cdn.pct)) prev.pct = Math.max(prev.pct, cdn.pct);
      if (Number.isFinite(line.index) && !prev.fromLines.includes(line.index)) {
        prev.fromLines.push(line.index);
      }
      byHost.set(host, prev);
    }
  }
  return [...byHost.values()].sort((a, b) => b.mbps - a.mbps);
}

/**
 * 解析线路排序：上次测速里 302 越快的越靠前；没测过的排后面（保持配置顺序）。
 * 智能条目本身、空前缀条目不参与。
 */
export function rankResolvers(entries, speedResult) {
  const latency = new Map();
  for (const line of speedResult?.lines || []) {
    if (Number.isFinite(line?.latencyMs)) latency.set(line.index, line.latencyMs);
  }
  return (entries || [])
    .map((entry, index) => ({
      index,
      entry,
      latencyMs: latency.has(index) ? latency.get(index) : Number.POSITIVE_INFINITY,
    }))
    .filter(({ entry }) => {
      if (!entry || entry.type === ENTRY_TYPE_AUTO) return false;
      return typeof entry.value === 'string' && entry.value.trim() !== '';
    })
    .sort((a, b) => a.latencyMs - b.latencyMs);
}

/** 某条线路在给定 BV / 分P 下要请求的 URL（空前缀返回空串）。 */
export function resolveUrlFor(entry, bvid, p = 0) {
  const value = typeof entry?.value === 'string' ? entry.value.trim() : '';
  if (!value) return '';
  if (entry.type === ENTRY_TYPE_API) return buildApiUrl(value, bvid, p);
  const pageUrl = `https://www.bilibili.com/video/${bvid}${p > 1 ? `?p=${p}` : ''}`;
  if (entry.type === ENTRY_TYPE_URL || value.includes('{url}')) {
    return applyPrefix(value, pageUrl) || pageUrl;
  }
  return applyPrefix(value, bvid) || bvid;
}

/* ------------------------------------------------------------------ *
 * 网络
 * ------------------------------------------------------------------ */

function makeSignal(ms) {
  if (typeof AbortController !== 'function') return { signal: undefined, done() {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer);
    },
  };
}

function errorText(error) {
  const name = error?.name;
  if (name === 'AbortError') return '超时';
  if (error?.message) return error.message;
  return String(error || '未知错误');
}

/** 跟一次跳转，把最终地址拿出来（只读 1 字节就取消响应体）。 */
async function followToCdn(url, { doFetch, now, timeoutMs }) {
  const guard = makeSignal(timeoutMs);
  const started = now();
  try {
    const response = await doFetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      headers: { range: 'bytes=0-0' },
      signal: guard.signal,
    });
    const ms = Math.round(now() - started);
    const finalUrl = response.url || '';
    const ok = response.ok || response.status === 206;
    try {
      await response.body?.cancel?.();
    } catch {
      // 取消失败不影响结果
    }
    if (!ok) return { ok: false, ms, status: response.status, finalUrl };
    return { ok: true, ms, status: response.status, finalUrl, host: hostOf(finalUrl) };
  } catch (error) {
    return { ok: false, ms: Math.round(now() - started), error: errorText(error) };
  } finally {
    guard.done();
  }
}

/** 解析接口（JSON）版本的解析：取 JSON 里的 url，字段形状和 followToCdn 一致。 */
async function resolveViaApi(url, { doFetch, now }) {
  const started = now();
  const result = await fetchApiTarget(url, { fetchImpl: doFetch, timeoutMs: AUTO_RESOLVE_TIMEOUT_MS });
  return {
    ok: result.ok,
    ms: Math.round(now() - started),
    status: result.ok ? 200 : 0,
    finalUrl: result.url,
    host: hostOf(result.url),
    error: result.error,
  };
}

/** 验证一个换过 host 的地址还能不能取到字节（只取 1 个字节）。 */
async function verifyUrl(url, { doFetch, now }) {
  const guard = makeSignal(AUTO_VERIFY_TIMEOUT_MS);
  const started = now();
  try {
    const response = await doFetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      headers: { range: 'bytes=0-0' },
      signal: guard.signal,
    });
    const ms = Math.round(now() - started);
    const ok = Boolean(response.ok) || response.status === 206;
    try {
      await response.body?.cancel?.();
    } catch {
      // 同上
    }
    return { ok: ok && ms <= AUTO_VERIFY_TIMEOUT_MS, ms, status: response.status };
  } catch (error) {
    return { ok: false, ms: Math.round(now() - started), error: errorText(error) };
  } finally {
    guard.done();
  }
}

/**
 * 点「智能最快节点」时执行的完整决策。
 *
 * @param {object} options
 * @param {{type:string,value:string,note:string}[]} options.entries 当前配置
 * @param {string} options.bvid 页面上的 BV 号
 * @param {number} [options.p] 分P（>1 时拼进 URL 型线路）
 * @param {object|null} [options.speedResult] 上次测速结果
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.clock]
 * @param {number} [options.budgetMs]
 * @returns {Promise<{ok:boolean, url:string, host:string, mbps:number|null, via:string,
 *   attempts:number, ms:number, reason:string, trail:object[]}>}
 */
export async function pickFastest({
  entries = [],
  bvid = '',
  p = 0,
  speedResult = null,
  fetchImpl = null,
  clock = null,
  budgetMs = AUTO_BUDGET_MS,
} = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    return { ok: false, url: '', reason: '当前环境没有 fetch', trail: [], attempts: 0, ms: 0 };
  }
  const now = clock || (() => Date.now());
  const startedMs = now();
  const deadline = startedMs + budgetMs;
  const trail = [];

  const finish = (extra) => ({
    ok: Boolean(extra.ok),
    url: extra.url || '',
    host: extra.host || hostOf(extra.url || ''),
    mbps: Number.isFinite(extra.mbps) ? extra.mbps : null,
    via: extra.via || '',
    attempts: trail.filter((item) => item.type === 'resolve').length,
    ms: Math.round(now() - startedMs),
    reason: extra.reason || '',
    trail,
  });

  if (!bvid) return finish({ ok: false, reason: '这个页面没有 BV 号' });
  const resolvers = rankResolvers(entries, speedResult);
  if (!resolvers.length) return finish({ ok: false, reason: '配置里没有可联网的解析线路' });

  const outOfTime = () => now() > deadline;
  const attemptsLeft = () => trail.filter((item) => item.type === 'resolve').length < AUTO_MAX_ATTEMPTS;

  let lastUrl = '';
  let lastHost = '';

  const resolveOnce = async (index) => {
    if (outOfTime() || !attemptsLeft()) return null;
    const entry = entries[index];
    const url = resolveUrlFor(entry, bvid, p);
    if (!url) return null;
    // JSON 接口没有 302，得自己取 JSON 再读 url 字段。
    const r =
      entry?.type === ENTRY_TYPE_API
        ? await resolveViaApi(url, { doFetch, now })
        : await followToCdn(url, { doFetch, now, timeoutMs: AUTO_RESOLVE_TIMEOUT_MS });
    trail.push({
      type: 'resolve',
      index,
      host: hostOf(url),
      ok: Boolean(r.ok),
      ms: r.ms,
      status: r.status || 0,
      finalHost: r.host || '',
      error: r.error || '',
    });
    if (r.ok && r.finalUrl) {
      lastUrl = r.finalUrl;
      lastHost = r.host || hostOf(r.finalUrl);
      return r;
    }
    return null;
  };

  const hosts = rankCdns(speedResult)
    .filter((item) => item.mbps >= AUTO_MIN_MBPS)
    .slice(0, AUTO_HOST_TRIES);

  // 没有任何测速数据：退化成「用最快的线路解析一次」，至少比手点菜单快。
  if (!hosts.length) {
    for (const resolver of resolvers.slice(0, 3)) {
      const r = await resolveOnce(resolver.index);
      if (r) {
        return finish({ ok: true, url: lastUrl, host: lastHost, via: 'resolver', reason: '还没有测速数据，按线路顺序解析' });
      }
    }
    return finish({ ok: false, reason: '解析线路都没能拿到可直接播放的地址' });
  }

  for (const target of hosts) {
    if (outOfTime()) break;
    const rewritable = isBilivideoHost(target.host);

    if (rewritable) {
      // 同族：先拿一条地址（没有就用最快的线路），再换 host 验证。
      if (!lastUrl) {
        for (const resolver of resolvers.slice(0, 2)) {
          const r = await resolveOnce(resolver.index);
          if (r) break;
        }
      }
      if (lastUrl) {
        const candidate = swapCdnHost(lastUrl, target.host);
        if (candidate) {
          const check = await verifyUrl(candidate, { doFetch, now });
          trail.push({ type: 'rewrite', from: lastHost, to: target.host, ok: check.ok, ms: check.ms, status: check.status || 0 });
          if (check.ok) {
            return finish({ ok: true, url: candidate, host: target.host, mbps: target.mbps, via: 'rewrite' });
          }
        }
      }
      continue;
    }

    // 跨族：只能找上次真的吐出这个节点的解析站，有限次重试。
    for (const index of target.fromLines.slice(0, 2)) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (outOfTime() || !attemptsLeft()) break;
        const r = await resolveOnce(index);
        if (!r) continue;
        if ((r.host || hostOf(r.finalUrl)) !== target.host) continue;
        const check = await verifyUrl(lastUrl, { doFetch, now });
        trail.push({ type: 'verify', host: target.host, ok: check.ok, ms: check.ms });
        if (check.ok) {
          return finish({ ok: true, url: lastUrl, host: target.host, mbps: target.mbps, via: 'resolver' });
        }
      }
      if (outOfTime() || !attemptsLeft()) break;
    }
  }

  // 都换不到：手上要是有能播的地址就直接给（比失败强），否则再兜底解析一次。
  if (lastUrl) {
    return finish({
      ok: true,
      url: lastUrl,
      host: lastHost,
      via: 'fallback',
      reason: '没能换到更快的节点，先给当前可用地址',
    });
  }
  for (const resolver of resolvers.slice(0, 3)) {
    const r = await resolveOnce(resolver.index);
    if (r) {
      return finish({ ok: true, url: lastUrl, host: lastHost, via: 'resolver', reason: '按线路顺序解析' });
    }
  }
  return finish({ ok: false, reason: '尝试过的解析线路都没拿到地址' });
}

/** 给设置页 / 图标提示用的一句话说明。 */
export function describePick(picked) {
  if (!picked?.ok) return `智能最快：失败（${picked?.reason || '未知原因'}）`;
  const speed = Number.isFinite(picked.mbps) ? ` · ${picked.mbps.toFixed(2)} MB/s` : '';
  const via = picked.via === 'rewrite' ? '换节点' : picked.via === 'resolver' ? '解析' : '兜底';
  return `智能最快：${picked.host || hostOf(picked.url)}${speed}（${via}，${picked.attempts} 次解析，${picked.ms} ms）`;
}
