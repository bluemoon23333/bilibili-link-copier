/**
 * 用户配置读写。
 *
 * 配置是一个有序列表，每一项是 `{ type, value, note }`：
 * - `type: 'url'`：value 后面接「最短有效链接」，例如
 *   `https://biliplayer.91vrchat.com/player/?url=` + `https://www.bilibili.com/video/BV1xx`
 * - `type: 'bv'` ：value 后面接「BV 号」，例如
 *   `http://ckapi.sevenbrothers.cn/bili/api?id=` + `BV1xx`
 * - `note`：备注，显示在设置页和右键菜单里，可为空。
 * - 空字符串是合法 value，表示只复制后半段（裸链接 / 裸 BV 号）。
 *
 * 位置决定用途：
 * - 第 1 条（下标 0）：单击扩展图标
 * - 第 2 条（下标 1）：双击扩展图标
 * - 第 3 条起（下标 2+）：右键菜单
 *
 * 默认存在 chrome.storage.sync（可跨设备同步），不可用时退回 chrome.storage.local。
 * 测速结果体积较大且没有同步价值，固定放 chrome.storage.local。
 */

import { normalizeBvid } from './bili.js';

export const ENTRY_TYPE_URL = 'url';
export const ENTRY_TYPE_BV = 'bv';
/**
 * 「智能最快节点」：不用填前缀，点一下就用上次测速的排名去拿最快的 CDN 直链。
 * 默认放在第 3 条，也就是右键菜单的第一项。
 */
export const ENTRY_TYPE_AUTO = 'auto';
/** 解析接口（返回 JSON）类型：扩展自己取 JSON 里的 url，典型是 Bili2VRC 用的那个接口。 */
export const ENTRY_TYPE_API = 'api';

/** 智能条目的默认备注。 */
export const AUTO_NOTE = '智能最快';

/** 第 1 条（下标 0）用于单击扩展图标。 */
export const SINGLE_INDEX = 0;
/** 第 2 条（下标 1）用于双击扩展图标。 */
export const DOUBLE_INDEX = 1;
/** 第 3 条（下标 2）起才出现在右键菜单里。 */
export const MENU_START_INDEX = 2;

/** 菜单里条目太多会很难用，这里设一个上限。 */
export const MAX_ENTRIES = 20;
/** 备注长度上限（设置页输入框 maxlength 与之一致）。 */
export const NOTE_MAX_LENGTH = 24;

/** 默认 7 条线路：前两条固定给单击/双击，第 3 条是智能最快，其余进右键菜单。 */
export const DEFAULT_ENTRIES = [
  { type: ENTRY_TYPE_BV, value: 'https://api.xuan25.com/bili-resolve/', note: '后海线路' },
  { type: ENTRY_TYPE_BV, value: '', note: '复制BV号' },
  { type: ENTRY_TYPE_AUTO, value: '', note: AUTO_NOTE },
  { type: ENTRY_TYPE_BV, value: 'http://ckapi.sevenbrothers.cn/bili/api?id=', note: '纯K线路' },
  { type: ENTRY_TYPE_BV, value: 'https://bil.ouo.chat/player/?url=', note: '星流线路' },
  { type: ENTRY_TYPE_BV, value: 'https://biliplayer.91vrchat.com/player/?url=', note: '孤线路' },
  { type: ENTRY_TYPE_BV, value: 'https://ktv.chiooone.com/player/?url=', note: '暖夜线路' },
];

/** 1.3.0 及更早版本的默认配置（只有一条「接链接」），升级时替换成新的 6 条。 */
const LEGACY_DEFAULT_ENTRIES = [
  { type: ENTRY_TYPE_URL, value: 'https://biliplayer.91vrchat.com/player/?url=', note: '' },
];

/** BV 号类型前缀的示例，仅用于设置页占位提示。 */
export const SAMPLE_BV_PREFIX = 'http://ckapi.sevenbrothers.cn/bili/api?id=';

export const STORAGE_KEY = 'linkPrefixes';
/** 1.1.0 及更早版本用的是单条字符串配置，读取时自动迁移。 */
export const LEGACY_STORAGE_KEY = 'linkPrefix';
/** 测速结果与测速参数（chrome.storage.local）。 */
export const SPEED_RESULT_KEY = 'speedTestResult';
export const SPEED_CONFIG_KEY = 'speedTestConfig';

function storageArea() {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  return chrome.storage.sync || chrome.storage.local || null;
}

function localArea() {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  return chrome.storage.local || chrome.storage.sync || null;
}

export function defaultEntries() {
  return DEFAULT_ENTRIES.map((entry) => ({ ...entry }));
}

/**
 * 归一化单个配置项：
 * - 字符串（1.2.0 的旧格式）按「接链接」处理；
 * - 其它非法值返回 null，由调用方过滤。
 */
export function normalizeEntry(item) {
  if (typeof item === 'string') return { type: ENTRY_TYPE_URL, value: item, note: '' };
  if (!item || typeof item !== 'object') return null;
  const note = typeof item.note === 'string' ? item.note.trim().slice(0, NOTE_MAX_LENGTH) : '';
  const type =
    item.type === ENTRY_TYPE_BV
      ? ENTRY_TYPE_BV
      : item.type === ENTRY_TYPE_AUTO
        ? ENTRY_TYPE_AUTO
        : item.type === ENTRY_TYPE_API
          ? ENTRY_TYPE_API
          : ENTRY_TYPE_URL;
  return {
    type,
    // 智能条目不用前缀，值一律清空，避免旧数据里残留的半截链接造成误解。
    value: type === ENTRY_TYPE_AUTO ? '' : typeof item.value === 'string' ? item.value : '',
    note,
  };
}

/** 归一化整个列表：过滤非法项、截断到上限、空列表回退默认值。 */
export function normalizeEntries(value) {
  if (!Array.isArray(value)) return defaultEntries();
  const list = value
    .map(normalizeEntry)
    .filter((entry) => entry !== null)
    .slice(0, MAX_ENTRIES);
  return list.length ? list : defaultEntries();
}

/** 把旧配置里没写备注、但 value 与默认线路一致的条目补上默认备注（不覆盖已有备注）。 */
export function backfillNotes(list) {
  const known = new Map();
  for (const entry of DEFAULT_ENTRIES) {
    if (entry.value) known.set(entry.value, entry.note);
  }
  let changed = false;
  const next = list.map((entry) => {
    if (entry.type === ENTRY_TYPE_AUTO) {
      if (entry.note) return entry;
      changed = true;
      return { ...entry, note: AUTO_NOTE };
    }
    if (entry.note || !known.has(entry.value)) return entry;
    changed = true;
    return { ...entry, note: known.get(entry.value) };
  });
  return { list: next, changed };
}

/** 从配置值里取出主机名，取不到就退回去掉协议的字符串。 */
export function entryHostHint(entry) {
  const value = typeof entry?.value === 'string' ? entry.value.trim() : '';
  if (!value) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./i, '');
  } catch {
    const stripped = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    return stripped.length > 28 ? `${stripped.slice(0, 27)}…` : stripped;
  }
}

/** 一句话说明这一条是干什么的（扩展图标 title、设置页标签都用它）。 */
export function entrySummary(entry) {
  if (!entry) return '';
  if (entry.type === ENTRY_TYPE_AUTO) return entry.note?.trim() || AUTO_NOTE;
  const note = typeof entry.note === 'string' ? entry.note.trim() : '';
  if (note) return note;
  const value = typeof entry.value === 'string' ? entry.value.trim() : '';
  if (!value) return entry.type === ENTRY_TYPE_BV ? '复制 BV 号' : '复制裸链接';
  const host = entryHostHint(entry) || value;
  return entry.type === ENTRY_TYPE_API ? `解析接口 ${host}` : host;
}

/** 这一条在界面上的角色：单击 / 双击 / 右键菜单。 */
export function entryRoleLabel(index) {
  if (index === SINGLE_INDEX) return '单击';
  if (index === DOUBLE_INDEX) return '双击';
  return '菜单';
}

/** 角色标签的样式类名。 */
export function entryRoleClass(index) {
  if (index === SINGLE_INDEX) return 'primary';
  if (index === DOUBLE_INDEX) return 'secondary';
  return 'menu';
}

/** 右键菜单里显示的条目名：`3. 纯K线路 · ckapi.sevenbrothers.cn` */
export function entryMenuTitle(entry, index) {
  const position = Number.isFinite(index) ? `${index + 1}. ` : '';
  const note = typeof entry?.note === 'string' ? entry.note.trim() : '';

  if (entry?.type === ENTRY_TYPE_AUTO) {
    const label = note.length > 18 ? `${note.slice(0, 17)}…` : note || AUTO_NOTE;
    return `${position}${label} · 自动挑最快节点`;
  }

  if (note) {
    const label = note.length > 18 ? `${note.slice(0, 17)}…` : note;
    const host = entryHostHint(entry);
    return host ? `${position}${label} · ${host}` : `${position}${label}`;
  }

  const value = typeof entry?.value === 'string' ? entry.value : '';
  const isBv = entry?.type === ENTRY_TYPE_BV;

  // JSON 接口：菜单里标一下 [API]，免得和「前缀 + BV」的站混在一起。
  if (entry?.type === ENTRY_TYPE_API) {
    const host = entryHostHint(entry);
    return host ? `${position}[API] ${host}` : `${position}[API] 解析接口`;
  }

  if (value === '') {
    return `${position}${isBv ? '复制 BV 号' : '复制裸链接'}`;
  }

  const label = value.replace(/^https?:\/\//i, '');
  const clipped = label.length > 40 ? `${label.slice(0, 39)}…` : label;
  return `${position}${isBv ? '[BV] ' : ''}${clipped}`;
}

/** 读取配置列表；没有配置过或读失败时返回默认值。 */
export async function loadEntries() {
  const area = storageArea();
  if (!area) return defaultEntries();
  try {
    const data = await area.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
    const stored = data ? data[STORAGE_KEY] : undefined;
    if (Array.isArray(stored)) {
      let list = normalizeEntries(stored);

      // 1.3.0 的原封默认配置只有一条「接链接」，升级时直接换成新的 6 条线路。
      if (isLegacyDefault(list)) {
        const upgraded = defaultEntries();
        await area.set({ [STORAGE_KEY]: upgraded });
        return upgraded;
      }

      const filled = backfillNotes(list);
      // 旧格式（字符串数组 / 缺备注）顺手写回新格式，避免每次都转换。
      const needsWrite = filled.changed || stored.some((item) => typeof item === 'string');
      if (needsWrite) await area.set({ [STORAGE_KEY]: filled.list });
      return filled.list;
    }
    // 1.1.0 的 linkPrefix 是单条字符串，迁移成列表第 1 项。
    if (data && typeof data[LEGACY_STORAGE_KEY] === 'string') {
      const migrated = normalizeEntries([data[LEGACY_STORAGE_KEY]]);
      await area.set({ [STORAGE_KEY]: migrated });
      return migrated;
    }
    return defaultEntries();
  } catch {
    return defaultEntries();
  }
}

function isLegacyDefault(list) {
  if (list.length !== 1) return false;
  const [only] = list;
  return LEGACY_DEFAULT_ENTRIES.some(
    (legacy) => legacy.value === only.value && legacy.type === only.type && !only.note,
  );
}

/** 保存配置列表，返回是否成功。 */
export async function saveEntries(list) {
  const area = storageArea();
  if (!area) return false;
  try {
    await area.set({ [STORAGE_KEY]: normalizeEntries(list) });
    return true;
  } catch {
    return false;
  }
}

/** 监听配置变化（设置页保存 / 其它窗口修改 / 跨设备同步）。 */
export function onEntriesChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (!changes[STORAGE_KEY] && !changes[LEGACY_STORAGE_KEY]) return;
    callback(areaName);
  });
}

/* ------------------------------------------------------------------ *
 * 测速结果 / 测速参数
 * ------------------------------------------------------------------ */

/** 上次测速的完整结果；没有就返回 null。 */
export async function loadSpeedResult() {
  const area = localArea();
  if (!area) return null;
  try {
    const data = await area.get([SPEED_RESULT_KEY]);
    const stored = data ? data[SPEED_RESULT_KEY] : null;
    return stored && Array.isArray(stored.lines) ? stored : null;
  } catch {
    return null;
  }
}

export async function saveSpeedResult(result) {
  const area = localArea();
  if (!area) return false;
  try {
    await area.set({ [SPEED_RESULT_KEY]: result });
    return true;
  } catch {
    return false;
  }
}

/** 测速参数：测试 BV 号 + 探测轮次。 */
export async function loadSpeedConfig(fallback = {}) {
  const area = localArea();
  const base = {
    bv: typeof fallback.bv === 'string' ? fallback.bv : '',
    depth: typeof fallback.depth === 'string' ? fallback.depth : 'normal',
  };
  if (!area) return base;
  try {
    const data = await area.get([SPEED_CONFIG_KEY]);
    const stored = data ? data[SPEED_CONFIG_KEY] : null;
    if (!stored || typeof stored !== 'object') return base;
    const bv = normalizeBvid(stored.bv) || base.bv;
    const depth = typeof stored.depth === 'string' ? stored.depth : base.depth;
    return { bv, depth };
  } catch {
    return base;
  }
}

export async function saveSpeedConfig(config) {
  const area = localArea();
  if (!area) return false;
  try {
    await area.set({
      [SPEED_CONFIG_KEY]: {
        bv: normalizeBvid(config?.bv) || '',
        depth: typeof config?.depth === 'string' ? config.depth : 'normal',
      },
    });
    return true;
  } catch {
    return false;
  }
}
