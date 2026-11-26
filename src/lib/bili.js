/**
 * B 站链接解析工具（纯函数，无 chrome API 依赖，可直接被 Node 单元测试导入）。
 */

const BVID_PATTERN = /BV[0-9A-Za-z]{10}/;
const BVID_EXACT = /^BV[0-9A-Za-z]{10}$/;
const BILI_HOST = /(^|\.)bilibili\.com$/i;
const LIVE_HOST = /^live\.bilibili\.com$/i;
const LIVE_ROOM_PATH = /^\/(?:[a-z]+\/)?(\d{3,})(?:\/|$)/i;
const LIST_PATH = /^\/list(\/|$)/i;
const SHORT_HOST = /(^|\.)(b23\.tv|bili2233\.cn|acg\.tv)$/i;
const VIDEO_PATH = /^\/video\/(BV[0-9A-Za-z]{10}|av\d+)(?:\/|$)/i;
const BANGUMI_PATH = /^\/bangumi\/play\/(ep\d+|ss\d+)(?:\/|$)/i;
const EP_EXACT = /^ep\d+$/i;

/** 追踪 / 统计 / 分享来源类参数属于噪音，拼短链时一律丢弃。 */
const TRACKING_PARAM_PATTERNS = [
  /^spm(_id_from)?$/i,
  /^vd_source$/i,
  /^from(_source|_spmid|_module)?$/i,
  /^share_(source|medium|plat|session_id|tag|times|id|channel|source_copy)$/i,
  /^bbid$/i,
  /^ts$/i,
  /^unique_k$/i,
  /^csource$/i,
  /^bsource$/i,
  /^buvid$/i,
  /^seid$/i,
  /^up_id$/i,
  /^navhide$/i,
  /^broadcast_type$/i,
  /^is_room_feed$/i,
  /^live_from$/i,
  /^msource$/i,
  /^wxfid$/i,
  /^plat_id$/i,
  /^timestamp$/i,
  /^t$/i,
  /^hotrank$/i,
  /^visit_id$/i,
  /^source$/i,
  /^ref(erer)?$/i,
  /^utm_.*$/i,
  /^_$/,
];

function isTrackingParam(key) {
  return TRACKING_PARAM_PATTERNS.some((re) => re.test(key));
}

/** 容错解析 URL：允许缺少协议头、允许前后有空白或引号 / 尖括号。 */
function toUrl(input) {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim().replace(/^[<"']+|[>"']+$/g, '');
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    /* 继续尝试补上协议头 */
  }
  try {
    return new URL('https://' + raw.replace(/^\/+/, ''));
  } catch {
    return null;
  }
}

/** BV 号标准化：统一前缀大小写，正文保持不变（正文大小写敏感）。 */
export function normalizeBvid(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!BVID_EXACT.test(raw)) return null;
  return 'BV' + raw.slice(2);
}

export function isValidBvid(value) {
  return normalizeBvid(value) !== null;
}

/** 从任意文本中抓取第一个 BV 号。 */
export function extractBvid(text) {
  if (typeof text !== 'string' || !text) return null;
  const match = text.match(BVID_PATTERN);
  return match ? normalizeBvid(match[0]) : null;
}

export function isBilibiliUrl(href) {
  const url = toUrl(href);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return BILI_HOST.test(host) || SHORT_HOST.test(host);
}

/** 分 P 序号：只接受大于 1 的整数（第 1 集不必写进链接）。 */
function toPartNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n) && n > 1) return n;
  }
  return 1;
}

/** B 站主域归一化：裸域补成 www，子域保持原样。 */
function canonicalHost(host) {
  return host === 'bilibili.com' ? 'www.bilibili.com' : host;
}

/**
 * 生成“最短有效链接”。
 *
 * @param {string} href 当前页面 URL（或任意待处理链接）
 * @param {{ bvid?: string, p?: number|string, epId?: string }} [info] 页面探测到的补充信息
 * @returns {string|null} 短链；不是 B 站链接时返回 null
 */
export function buildShortUrl(href, info = {}) {
  const url = toUrl(href);
  if (!url) return null;

  const host = url.hostname.toLowerCase();

  // b23.tv / bili2233.cn 这类官方短链本身就是最短形式，只去掉查询串和井号。
  if (SHORT_HOST.test(host)) {
    const path = url.pathname.replace(/\/+$/, '');
    return path ? `https://${host}${path}` : `https://${host}/`;
  }

  if (!BILI_HOST.test(host)) return null;

  // 直播间：统一成 https://live.bilibili.com/<房间号>，去掉追踪参数和分区前缀。
  if (LIVE_HOST.test(host)) {
    const roomMatch = url.pathname.match(LIVE_ROOM_PATH);
    const roomId = roomMatch ? roomMatch[1] : '';
    return roomId ? `https://live.bilibili.com/${roomId}` : `https://${host}/`;
  }

  const bvid = normalizeBvid(info.bvid);
  const videoMatch = url.pathname.match(VIDEO_PATH);
  if (videoMatch) {
    // 路径里是 av 号时，优先使用页面里探测到的 BV 号（BV 是新版规范 ID）。
    const rawId = videoMatch[1];
    const id = bvid || (rawId.toLowerCase().startsWith('av') ? rawId.toLowerCase() : 'BV' + rawId.slice(2));
    const part = toPartNumber(info.p, url.searchParams.get('p'));
    return `https://www.bilibili.com/video/${id}${part > 1 ? `?p=${part}` : ''}`;
  }

  // 列表页（稍后再看 / 合集 / 播放列表）：URL 里带 bvid 时换成那条视频的链接，
  // 这样贴到 VRChat 里才是能解析的地址，而不是一个列表页。
  if (LIST_PATH.test(url.pathname)) {
    const listBvid = normalizeBvid(info.bvid) || normalizeBvid(url.searchParams.get('bvid') || '') || extractBvid(href || '');
    if (listBvid) {
      const part = toPartNumber(info.p, url.searchParams.get('p'));
      return `https://www.bilibili.com/video/${listBvid}${part > 1 ? `?p=${part}` : ''}`;
    }
  }

  const bangumiMatch = url.pathname.match(BANGUMI_PATH);
  if (bangumiMatch) {
    const raw = bangumiMatch[1].toLowerCase();
    // 整季链接（ss）能通过页面信息定位到当前集时，直接给具体集数链接。
    const epId = EP_EXACT.test(String(info.epId || '')) ? String(info.epId).toLowerCase() : null;
    const id = raw.startsWith('ss') && epId ? epId : raw;
    return `https://www.bilibili.com/bangumi/play/${id}`;
  }

  // 其它页面（空间、动态、直播、专栏、稍后再看……）：只清追踪参数，保留业务参数。
  const params = [];
  url.searchParams.forEach((value, key) => {
    if (!isTrackingParam(key)) params.push([key, value]);
  });
  const search = params.length
    ? '?' + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return `https://${canonicalHost(host)}${path}${search}`;
}

/** 页面身份判断：是否为 B 站视频 / 番剧播放页。 */
export function isBilibiliVideoPage(href) {
  const url = toUrl(href);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  if (!BILI_HOST.test(host)) return false;
  return VIDEO_PATH.test(url.pathname) || BANGUMI_PATH.test(url.pathname);
}

/**
 * 在链接前面拼接用户自定义字符串。
 *
 * - 前缀为空（或全是空白）时原样返回链接；
 * - 前缀含 `{url}` 时用链接替换占位符（可放在中间）；
 * - 前缀含 `{bv}` 时替换为链接里的 BV 号；
 * - 其余情况按原样直接前置拼接，不做任何转义。
 *
 * @param {string} prefix 用户配置的前缀
 * @param {string} link 最短有效链接
 * @returns {string|null}
 */
export function applyPrefix(prefix, link) {
  if (typeof link !== 'string' || !link) return null;
  if (typeof prefix !== 'string' || prefix === '') return link;

  if (prefix.includes('{url}') || prefix.includes('{bv}')) {
    return prefix
      .split('{url}')
      .join(link)
      .split('{bv}')
      .join(extractBvid(link) || '');
  }

  return prefix + link;
}
