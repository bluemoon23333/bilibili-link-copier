import { applyPrefix, buildShortUrl, extractBvid, isValidBvid, normalizeBvid } from './lib/bili.js';
import { buildApiUrl, fetchApiTarget } from './lib/api.js';
import { describePick, pickFastest } from './lib/auto.js';
import {
  DOUBLE_INDEX,
  ENTRY_TYPE_API,
  ENTRY_TYPE_AUTO,
  ENTRY_TYPE_BV,
  MENU_START_INDEX,
  SINGLE_INDEX,
  entryMenuTitle,
  entrySummary,
  loadEntries,
  loadSpeedResult,
  onEntriesChanged,
} from './lib/settings.js';

/** 判定“双击”的时间窗（毫秒）：第二次点击落在窗口内即视为双击。 */
const DOUBLE_CLICK_WINDOW_MS = 450;
/** 角标保留时长。 */
const BADGE_HOLD_MS = 1800;
/** 离屏文档路径（相对扩展根目录）。 */
const OFFSCREEN_PATH = 'src/offscreen.html';
/** 离屏文档刚创建时消息监听器可能尚未注册，需要重试。 */
const COPY_RETRY_TIMES = 8;
const COPY_RETRY_DELAY_MS = 60;
/** 空闲多久后关闭离屏文档。 */
const OFFSCREEN_IDLE_MS = 30000;

const BADGES = {
  api: { text: 'API', color: '#00A1D6' },
  prefixed: { text: 'URL+', color: '#7C5CFF' },
  bv: { text: 'BV', color: '#FB7299' },
  url: { text: 'URL', color: '#00A1D6' },
  auto: { text: '⚡', color: '#FB7299' },
  error: { text: '!', color: '#D7263D' },
};

/** 右键扩展图标菜单项。 */
const MENU_OPTIONS = 'open-options';
const MENU_SPEED = 'speed-test';
const MENU_SEPARATOR = 'separator';
/** 配置条目的菜单 id 形如 prefix:3，数字是它在配置列表里的下标（第 3 条起才进菜单）。 */
const PREFIX_MENU_PREFIX = 'prefix:';

/** 串行执行队列：保证“先复制带前缀链接、后复制裸链接”的顺序不会被异步打乱。 */
let taskChain = Promise.resolve();
/** 记住上一次点击来自哪个标签页：双击只在同一标签页内成立。 */
let lastClick = { tabId: null, at: 0 };
/** 每个标签页各自维护角标清除定时器。 */
const badgeTimers = new Map();
let offscreenIdleTimer = null;
let runningTasks = 0;

chrome.runtime.onInstalled.addListener(() => refreshUi());
chrome.runtime.onStartup.addListener(() => refreshUi());
// 配置变更后（设置页保存 / 其它设备同步过来）立刻重建菜单。
onEntriesChanged(() => refreshUi());
// Service Worker 冷启动（浏览器重启、被杀后重新唤醒）时也要保证菜单存在。
refreshUi();

/** 重建菜单 + 刷新图标说明文字。 */
async function refreshUi() {
  await setupContextMenus();
  await updateActionTitle();
}

/**
 * 右键扩展图标弹出的菜单：
 * 配置里第 3 条起（下标 2+）的线路 / 分隔线 / 测速入口 / 设置入口。
 */
async function setupContextMenus() {
  let entries = [];
  try {
    entries = await loadEntries();
  } catch {
    entries = [];
  }
  const extras = entries.slice(MENU_START_INDEX);
  const swallow = () => void chrome.runtime.lastError;

  chrome.contextMenus.removeAll(() => {
    extras.forEach((entry, offset) => {
      const index = offset + MENU_START_INDEX;
      chrome.contextMenus.create(
        {
          id: `${PREFIX_MENU_PREFIX}${index}`,
          title: entryMenuTitle(entry, index),
          contexts: ['action'],
        },
        swallow,
      );
    });
    chrome.contextMenus.create(
      { id: MENU_SEPARATOR, type: 'separator', contexts: ['action'] },
      swallow,
    );
    chrome.contextMenus.create(
      { id: MENU_SPEED, title: '线路测速…', contexts: ['action'] },
      swallow,
    );
    chrome.contextMenus.create(
      { id: MENU_OPTIONS, title: '设置前缀与备注…', contexts: ['action'] },
      swallow,
    );
  });
}

/** 图标悬停提示：直接写清楚单击 / 双击会复制什么。 */
async function updateActionTitle() {
  if (!chrome.action || typeof chrome.action.setTitle !== 'function') return;
  let entries = [];
  try {
    entries = await loadEntries();
  } catch {
    entries = [];
  }
  const single = entrySummary(entries[SINGLE_INDEX]) || '第 1 条线路';
  const double = entrySummary(entries[DOUBLE_INDEX]) || '复制裸链接';
  try {
    await chrome.action.setTitle({
      title: `单击：${single}　双击：${double}　右键：更多线路 / 测速`.slice(0, 120),
    });
  } catch {
    // 图标不可用时忽略
  }
}

/** 打开设置页；带锚点时直达对应面板（比如测速）。 */
function openOptionsPage(anchor) {
  try {
    if (chrome.tabs && typeof chrome.tabs.create === 'function') {
      const url = `${chrome.runtime.getURL('src/options.html')}${anchor ? `#${anchor}` : ''}`;
      const created = chrome.tabs.create({ url });
      if (created && typeof created.catch === 'function') {
        created.catch(() => chrome.runtime.openOptionsPage());
      }
      return;
    }
  } catch {
    // 落到下面的 openOptionsPage
  }
  chrome.runtime.openOptionsPage();
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_OPTIONS) {
    openOptionsPage('');
    return;
  }
  if (info.menuItemId === MENU_SPEED) {
    openOptionsPage('speed');
    return;
  }

  const match = /^prefix:(\d+)$/.exec(String(info.menuItemId || ''));
  if (!match) return;
  const index = Number.parseInt(match[1], 10);
  if (!Number.isFinite(index)) return;

  // 菜单可能是旧列表生成的，这里再读一次配置；下标越界就不复制。
  const entries = await loadEntries();
  if (!entries[index]) {
    showBadge(typeof tab?.id === 'number' ? tab.id : null, 'error');
    return;
  }
  enqueue(tab, { type: 'index', index });
});

chrome.action.onClicked.addListener((tab) => {
  const now = Date.now();
  const tabId = tab && typeof tab.id === 'number' ? tab.id : null;
  const isDoubleClick =
    lastClick.tabId === tabId && now - lastClick.at <= DOUBLE_CLICK_WINDOW_MS;
  // 判定为双击后清零，避免连点三下被当成两次双击。
  lastClick = isDoubleClick ? { tabId: null, at: 0 } : { tabId, at: now };
  // 单击用第 1 条，双击用第 2 条（默认是「复制 BV 号」这条空前缀配置）。
  enqueue(
    tab,
    isDoubleClick
      ? { type: 'index', index: DOUBLE_INDEX, plainFallback: true }
      : { type: 'first' },
  );
});

/** 把一次复制任务排进串行队列，并管理离屏文档的生命周期。返回这次复制是否成功。 */
function enqueue(tab, action) {
  runningTasks += 1;
  if (offscreenIdleTimer) {
    clearTimeout(offscreenIdleTimer);
    offscreenIdleTimer = null;
  }

  const task = taskChain
    .then(() => handleAction(tab, action))
    .catch((error) => {
      console.error('[bili-copy] 处理失败', error);
      return false;
    })
    .finally(() => {
      runningTasks -= 1;
      if (runningTasks === 0) scheduleOffscreenClose();
    });
  taskChain = task;
  return task;
}

/**
 * 所有复制动作的统一入口。
 *
 * 两种动作：
 * - `{ type: 'first' }`：单击 → 配置第 1 项（前缀 + 链接，或前缀 + BV 号）
 * - `{ type: 'index', index }`：双击（第 2 项）或右键菜单（第 3 项起）
 *
 * 设计取舍：单击动作“立即执行”，不等双击窗口，因此单击零延迟；
 * 若 450ms 内出现第二次点击，则在同一队列里追加一次复制，用第 2 条
 * （默认是空前缀的「复制 BV 号」）覆盖刚写入的内容。
 * 第 2 条被删掉时（`plainFallback`），双击退回「裸最短链接」。
 */
async function handleAction(tab, action) {
  const tabId = tab && typeof tab.id === 'number' ? tab.id : null;
  const info = await probePage(tabId);
  const href = (info && info.href) || '';
  const bvid = pickBvid(info, href);

  // 取这一项配置：单击取第 1 项，双击 / 菜单取对应下标。
  let entry = null;
  const entries = await loadEntries();
  const stored = action.type === 'first' ? entries[SINGLE_INDEX] : entries[action.index];
  if (!stored) {
    if (!action.plainFallback) {
      showBadge(tabId, 'error');
      return false;
    }
  } else {
    entry = stored;
  }

  // 智能最快：不拼链接，直接按上次测速的排名去换节点 / 重新解析。
  if (entry && entry.type === ENTRY_TYPE_AUTO) {
    const speedResult = await loadSpeedResult().catch(() => null);
    const picked = await pickFastest({ entries, bvid, p: (info && info.p) || 0, speedResult });
    console.log('[bili-copy]', describePick(picked), picked.trail);
    if (!picked.ok || !picked.url) {
      showBadge(tabId, 'error');
      return false;
    }
    const copiedAuto = await copyText(tabId, picked.url);
    showBadge(tabId, copiedAuto ? 'auto' : 'error');
    return copiedAuto;
  }

  // JSON 接口线路：扩展自己去取 JSON 里的直链，取不到就报错（不拼前缀）。
  if (entry && entry.type === ENTRY_TYPE_API) {
    const endpoint = buildApiUrl(entry.value, bvid, (info && info.p) || 0);
    if (!endpoint) {
      showBadge(tabId, 'error');
      return false;
    }
    const target = await fetchApiTarget(endpoint);
    if (!target.ok) {
      console.warn('[bili-copy] 解析接口失败：', target.error);
      showBadge(tabId, 'error');
      return false;
    }
    const copiedApi = await copyText(tabId, target.url);
    showBadge(tabId, copiedApi ? 'api' : 'error');
    return copiedApi;
  }

  // 拼接的内容只有两种：最短有效链接，或 BV 号。
  const wantsBv = entry !== null && entry.type === ENTRY_TYPE_BV;
  const base = wantsBv
    ? bvid
    : buildShortUrl(href, {
        bvid: bvid || undefined,
        p: info && info.p,
        epId: info && info.epId,
      });
  if (!base) {
    showBadge(tabId, 'error');
    return false;
  }

  const prefix = entry ? entry.value : '';
  const text = applyPrefix(prefix, base) || base;
  const copied = await copyText(tabId, text);
  const kind = prefix ? 'prefixed' : wantsBv ? 'bv' : 'url';
  showBadge(tabId, copied ? kind : 'error');
  return copied;
}

/**
 * 页面右下角的「复制链接」小按钮（content script 注入）点一下 = 点一下扩展图标。
 * 返回是否复制成功，页面据此弹一个很轻的提示。
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.action !== 'copy-first') return false;
  const tab = sender && sender.tab ? sender.tab : null;
  if (!tab || typeof tab.id !== 'number') {
    sendResponse({ ok: false, reason: '没有拿到标签页' });
    return false;
  }
  enqueue(tab, { type: 'first' })
    .then((ok) => sendResponse({ ok: Boolean(ok) }))
    .catch(() => sendResponse({ ok: false, reason: '复制失败' }));
  return true;
});

function pickBvid(info, href) {
  if (info && isValidBvid(info.bvid)) return normalizeBvid(info.bvid);
  return extractBvid(href);
}

/** 读取页面信息：URL 总是可用，BV 号 / 分 P / 番剧集号属于“能取就取”。 */
async function probePage(tabId) {
  if (tabId === null) return null;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectPageInfo,
    });
    if (result && result.result) return result.result;
  } catch {
    // chrome:// 页面、PDF、无权限等情况：退回标签页 URL。
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab && tab.url ? { href: tab.url, bvid: '', p: 0, epId: '' } : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 下面两个函数会被注入到页面里执行，必须自包含（不能引用外部变量）。
 * ------------------------------------------------------------------ */

function collectPageInfo() {
  const info = { href: location.href, bvid: '', p: 0, epId: '' };
  const asText = (value) => (typeof value === 'string' && value ? value : '');
  const asNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const bvidPattern = /BV[0-9A-Za-z]{10}/;

  try {
    const state = window.__INITIAL_STATE__ || {};
    const videoData = state.videoData || {};
    const epInfo = state.epInfo || state.episodeInfo || (state.mediaInfo && state.mediaInfo.epInfo) || {};
    info.bvid = asText(state.bvid) || asText(videoData.bvid) || asText(epInfo.bvid);
    info.p = asNumber(state.p) || asNumber(videoData.p);
    info.epId = asText(epInfo.ep_id) || asText(epInfo.id);
  } catch {
    // 忽略：__INITIAL_STATE__ 结构会随站点版本变化
  }

  if (!info.bvid) {
    try {
      const node = document.querySelector(
        'link[rel="canonical"], meta[property="og:url"], meta[itemprop="url"]',
      );
      const raw = node ? node.getAttribute('href') || node.getAttribute('content') || '' : '';
      const match = raw.match(bvidPattern);
      if (match) info.bvid = match[0];
    } catch {
      // 忽略
    }
  }

  if (!info.bvid) {
    const match = info.href.match(bvidPattern);
    if (match) info.bvid = match[0];
  }

  return info;
}

function pageClipboardWrite(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'readonly');
  area.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none;z-index:-1;';
  (document.body || document.documentElement).appendChild(area);

  const selection = document.getSelection();
  const savedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  area.select();
  area.setSelectionRange(0, area.value.length);

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }

  area.remove();
  if (savedRange && selection) {
    try {
      selection.removeAllRanges();
      selection.addRange(savedRange);
    } catch {
      // 选区已被销毁，忽略
    }
  }
  return ok;
}

/* ------------------------------------------------------------------ *
 * 剪贴板写入：优先离屏文档，失败再退回注入页面。
 * ------------------------------------------------------------------ */

async function copyText(tabId, text) {
  if (!text) return false;
  if (await copyViaOffscreen(text)) return true;
  return copyViaPage(tabId, text);
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) return false;
  try {
    if (typeof chrome.offscreen.hasDocument === 'function' && (await chrome.offscreen.hasDocument())) {
      return true;
    }
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['CLIPBOARD'],
      justification: '需要离屏文档才能稳定地把文本写入系统剪贴板。',
    });
    return true;
  } catch (error) {
    // 已存在离屏文档时创建会报错，视为成功。
    if (/single offscreen|already exists/i.test(String(error))) return true;
    return false;
  }
}

async function copyViaOffscreen(text) {
  try {
    if (!(await ensureOffscreenDocument())) return false;
    for (let attempt = 0; attempt < COPY_RETRY_TIMES; attempt += 1) {
      try {
        const reply = await chrome.runtime.sendMessage({ type: 'copy-to-clipboard', text });
        if (reply && reply.ok) return true;
        if (reply && reply.ok === false) return false;
      } catch (error) {
        if (!/Receiving end does not exist|Could not establish connection/i.test(String(error))) {
          return false;
        }
      }
      await sleep(COPY_RETRY_DELAY_MS);
    }
    return false;
  } catch {
    return false;
  }
}

async function copyViaPage(tabId, text) {
  if (tabId === null) return false;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: pageClipboardWrite,
      args: [text],
    });
    return Boolean(result && result.result);
  } catch {
    return false;
  }
}

function scheduleOffscreenClose() {
  if (!chrome.offscreen) return;
  if (offscreenIdleTimer) clearTimeout(offscreenIdleTimer);
  offscreenIdleTimer = setTimeout(async () => {
    offscreenIdleTimer = null;
    if (runningTasks > 0) return;
    try {
      if (typeof chrome.offscreen.hasDocument === 'function' && (await chrome.offscreen.hasDocument())) {
        await chrome.offscreen.closeDocument();
      }
    } catch {
      // 关闭失败不影响功能
    }
  }, OFFSCREEN_IDLE_MS);
}

async function showBadge(tabId, kind) {
  const badge = BADGES[kind] || BADGES.error;
  try {
    if (tabId === null) {
      await chrome.action.setBadgeBackgroundColor({ color: badge.color });
      await chrome.action.setBadgeText({ text: badge.text });
    } else {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
      await chrome.action.setBadgeText({ tabId, text: badge.text });
    }

    const key = tabId === null ? 'global' : tabId;
    const existing = badgeTimers.get(key);
    if (existing) clearTimeout(existing);
    badgeTimers.set(
      key,
      setTimeout(() => {
        badgeTimers.delete(key);
        const clearOptions = tabId === null ? { text: '' } : { tabId, text: '' };
        chrome.action.setBadgeText(clearOptions).catch(() => {});
      }, BADGE_HOLD_MS),
    );
  } catch {
    // 标签页已关闭等情况，忽略
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
