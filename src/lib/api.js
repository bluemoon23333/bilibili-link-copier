/**
 * `解析接口（返回 JSON）` 这类线路的公共逻辑。
 *
 * 有些解析站不提供「一个 URL 进去、302 出来」的形态，而是：
 *   GET https://api.squidtail.com/bili2vrc/parse/?bv=BV…&p=1&format=mp4&otype=json
 *   → {"code":0,"quality":64,"url":"https://upos-…/*.mp4?…"}
 * 典型就是 Bili2VRC 用的那个接口。这种站拼不成前缀，只能由扩展自己取 JSON、
 * 再读 `url` 字段，所以单独给它一个条目类型 `api`。
 */

/** 默认就把这几个参数带上：bv 必需；p 是分P；format=mp4 才是带音轨的整段视频。 */
export function buildApiUrl(endpoint, bvid, p = 0) {
  const base = typeof endpoint === 'string' ? endpoint.trim() : '';
  if (!base) return '';
  let url;
  try {
    url = new URL(base);
  } catch {
    return '';
  }
  // 允许用户直接粘带参数的地址（有些站的参数名不一样），只补缺的那几个。
  if (!url.searchParams.has('bv') && !url.searchParams.has('bvid')) url.searchParams.set('bv', bvid);
  if (!url.searchParams.has('p')) url.searchParams.set('p', String(p > 0 ? p : 1));
  if (!url.searchParams.has('format')) url.searchParams.set('format', 'mp4');
  if (!url.searchParams.has('otype')) url.searchParams.set('otype', 'json');
  return url.toString();
}

/**
 * 请求解析接口，把 JSON 里的直链取出来。
 *
 * @returns {Promise<{ok:boolean, url:string, quality:number|null, ms:number, error:string}>}
 */
export async function fetchApiTarget(url, { fetchImpl = null, timeoutMs = 8000, signal = null } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const started = Date.now();
  if (typeof doFetch !== 'function') {
    return { ok: false, url: '', quality: null, ms: 0, error: '当前环境没有 fetch' };
  }
  let guard = null;
  try {
    guard = withTimeout(signal, timeoutMs);
    const response = await doFetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      signal: guard.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    const ms = Date.now() - started;
    if (!response.ok) {
      return { ok: false, url: '', quality: null, ms, error: `解析接口返回 HTTP ${response.status}` };
    }
    const data = await response.json().catch(() => null);
    const target = typeof data?.url === 'string' ? data.url.trim() : '';
    if (!target) {
      const message = typeof data?.message === 'string' && data.message ? data.message : '解析接口没有返回 url';
      return { ok: false, url: '', quality: null, ms, error: message };
    }
    return {
      ok: true,
      url: target,
      quality: Number.isFinite(data?.quality) ? data.quality : null,
      ms,
      error: '',
    };
  } catch (error) {
    return { ok: false, url: '', quality: null, ms: Date.now() - started, error: describeError(error) };
  } finally {
    guard?.done?.();
  }
}

function withTimeout(signal, ms) {
  if (typeof AbortController !== 'function') return { signal: signal || undefined, done() {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  if (signal && typeof signal.addEventListener === 'function') {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer);
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
    },
  };
}

function describeError(error) {
  if (error?.name === 'AbortError') return '解析接口超时或已取消';
  return error?.message || String(error || '未知错误');
}
