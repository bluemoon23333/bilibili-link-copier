/**
 * 点击流仿真测试：用假的 chrome API 驱动 src/background.js，验证新的操作模型
 *   单击      → 剪贴板 = 第 1 条配置
 *   双击      → 剪贴板 = 第 2 条配置（第 2 条不存在时退回裸链接）
 *   右键菜单  → 第 3 条起的配置 + 测速 + 设置（不再有固定的「复制 BV 号」）
 *
 * 运行：node tools/test-click-flow.mjs
 */

import assert from 'node:assert/strict';

import { DEFAULT_ENTRIES, loadEntries, saveEntries } from '../src/lib/settings.js';

const BV = 'BV1fMYi6EEaP';
const PLAIN = `https://www.bilibili.com/video/${BV}?p=2`;
const FIRST_PREFIX = 'https://first.example/?url=';
const SECOND_PREFIX = 'https://second.example/?u=';
const THIRD_PREFIX = 'https://third.example/?url=';
const BV_API_PREFIX = 'http://ckapi.sevenbrothers.cn/bili/api?id=';
const DEFAULT_FIRST = DEFAULT_ENTRIES[0].value;

const urlEntry = (value, note = '') => ({ type: 'url', value, note });
const bvEntry = (value, note = '') => ({ type: 'bv', value, note });

let clipboard = [];
let badgeTexts = [];
let titles = [];
let clickHandler = null;
let menuHandler = null;
let createdMenus = [];
let startupHandlers = [];
let storageListeners = [];
let messageHandler = null;
let optionsOpened = 0;
let createdTabs = [];
let pageUrl = `https://www.bilibili.com/video/${BV}?p=2&spm_id_from=333.999.0.0&vd_source=abc`;
let pageBvid = BV;
let pagePart = 2;
const store = new Map();

globalThis.chrome = {
  action: {
    onClicked: {
      addListener(handler) {
        clickHandler = handler;
      },
    },
    setBadgeText: async (options) => {
      badgeTexts.push(options.text);
    },
    setBadgeBackgroundColor: async () => {},
    setTitle: async (options) => {
      titles.push(options.title);
    },
  },
  runtime: {
    lastError: undefined,
    getURL: (path) => `chrome-extension://test/${path}`,
    onInstalled: { addListener: (handler) => startupHandlers.push(handler) },
    onStartup: { addListener: (handler) => startupHandlers.push(handler) },
    openOptionsPage: () => {
      optionsOpened += 1;
    },
    sendMessage: async (message) => {
      if (message && message.type === 'copy-to-clipboard') {
        clipboard.push(String(message.text));
        return { ok: true };
      }
      return undefined;
    },
    // 页面里的浮动按钮通过这个通道请求「点一下扩展图标」
    onMessage: {
      addListener(handler) {
        messageHandler = handler;
      },
    },
  },
  contextMenus: {
    removeAll: (callback) => {
      createdMenus = [];
      callback?.();
    },
    create: (properties) => {
      createdMenus.push({ id: properties.id, title: properties.title, type: properties.type });
    },
    onClicked: {
      addListener(handler) {
        menuHandler = handler;
      },
    },
  },
  scripting: {
    executeScript: async ({ args }) => {
      if (args) {
        clipboard.push(String(args[0]));
        return [{ result: true }];
      }
      return [{ result: { href: pageUrl, bvid: pageBvid, p: pagePart, epId: '' } }];
    },
  },
  storage: {
    sync: {
      get: async (keys) => {
        const wanted = Array.isArray(keys) ? keys : [keys];
        const result = {};
        for (const key of wanted) {
          if (store.has(key)) result[key] = store.get(key);
        }
        return result;
      },
      set: async (items) => {
        for (const [key, value] of Object.entries(items)) store.set(key, value);
      },
    },
    onChanged: {
      addListener: (handler) => storageListeners.push(handler),
    },
  },
  offscreen: {
    hasDocument: async () => true,
    createDocument: async () => {},
    closeDocument: async () => {},
  },
  tabs: {
    get: async () => ({ url: pageUrl }),
    create: async (options) => {
      createdTabs.push(options);
      return { id: 99, ...options };
    },
  },
};

await import('../src/background.js');
assert.equal(typeof clickHandler, 'function', 'background.js 应注册 action.onClicked 监听器');
assert.equal(typeof menuHandler, 'function', 'background.js 应注册 contextMenus.onClicked 监听器');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => wait(450);
// 清空前先让上一轮的复制任务落地，避免残留写入干扰下一条断言。
const resetClipboard = async () => {
  await settle();
  clipboard.length = 0;
  badgeTexts.length = 0;
};
const click = () => clickHandler({ id: 7, url: pageUrl });
const chooseMenu = (menuItemId) => menuHandler({ menuItemId }, { id: 7, url: pageUrl });
const setEntries = (list) => store.set('linkPrefixes', list);
const menuIds = () => createdMenus.map((item) => item.id);
const menuTitles = () => createdMenus.map((item) => item.title);
const lastBadge = () => badgeTexts[badgeTexts.length - 1];
const lastTitle = () => titles[titles.length - 1];

/** 重建菜单，等价于扩展启动 / 配置变更后重新注册。 */
async function rebuildMenus() {
  await Promise.all(startupHandlers.map((handler) => handler()));
  await wait(60);
}

/** 模拟配置在别处被改动（设置页保存、跨设备同步）。 */
async function notifyStorageChange() {
  for (const listener of storageListeners) listener({ linkPrefixes: { newValue: [] } }, 'sync');
  await wait(80);
}

// 等模块顶层那次 refreshUi() 落地，避免和后面的 rebuildMenus 抢跑
await wait(120);

// 0) 旧格式迁移：1.1.0 的单条字符串 → 列表第 1 项
store.clear();
store.set('linkPrefix', 'legacy=');
assert.deepEqual(await loadEntries(), [urlEntry('legacy=')], '旧单条配置应迁移成列表第 1 项');
assert.deepEqual(store.get('linkPrefixes'), [urlEntry('legacy=')], '迁移结果应写回新键');

// 0.1) 旧格式迁移：1.2.0 的字符串数组 → 对象数组
store.clear();
store.set('linkPrefixes', ['a', 'b']);
assert.deepEqual(await loadEntries(), [urlEntry('a'), urlEntry('b')], '字符串数组应迁移成对象数组');
assert.deepEqual(store.get('linkPrefixes'), [urlEntry('a'), urlEntry('b')], '迁移结果应写回');

// 0.2) 保存规则
await saveEntries([]);
assert.deepEqual(store.get('linkPrefixes'), DEFAULT_ENTRIES, '空列表应回退默认配置');
await saveEntries([bvEntry(BV_API_PREFIX), 'x', { type: 'nope', value: 'y' }, 42]);
assert.deepEqual(
  store.get('linkPrefixes'),
  [bvEntry(BV_API_PREFIX), urlEntry('x'), urlEntry('y')],
  '非法项应被过滤、未知类型回退 url',
);

// 0.3) 默认配置：7 条线路，第 3 条是「智能最快节点」
store.clear();
const defaults = await loadEntries();
assert.equal(defaults.length, 7, '默认应有 7 条线路');
assert.deepEqual(
  defaults.map((entry) => entry.note),
  ['后海线路', '复制BV号', '智能最快', '纯K线路', '星流线路', '孤线路', '暖夜线路'],
  '默认备注应按顺序给出',
);
assert.equal(defaults[2].type, 'auto', '第 3 条应是智能最快节点');

// 1) 默认配置下的右键菜单：第 3 条起 + 测速 + 设置，没有固定的「复制 BV 号」
await rebuildMenus();
assert.deepEqual(
  menuIds(),
  ['prefix:2', 'prefix:3', 'prefix:4', 'prefix:5', 'prefix:6', 'separator', 'speed-test', 'open-options'],
  '菜单应从第 3 条起，并包含测速与设置',
);
assert.equal(menuIds().includes('copy-bv'), false, '不应再有固定的「复制 BV 号」菜单项');
assert.deepEqual(
  menuTitles().slice(0, 5),
  [
    '3. 智能最快 · 自动挑最快节点',
    '4. 纯K线路 · ckapi.sevenbrothers.cn',
    '5. 星流线路 · bil.ouo.chat',
    '6. 孤线路 · biliplayer.91vrchat.com',
    '7. 暖夜线路 · ktv.chiooone.com',
  ],
  '菜单标题应带序号 + 备注 + 主机名，智能条目还要说明它会自动挑节点',
);
assert.equal(lastTitle(), `单击：后海线路　双击：复制BV号　右键：更多线路 / 测速`, '图标 tooltip 应说明三条路径');

// 2) 单击：第 1 条（后海线路，接 BV 号）
clipboard = [];
badgeTexts = [];
click();
await settle();
assert.deepEqual(clipboard, [DEFAULT_FIRST + BV], '单击应复制第 1 条 + BV 号');
assert.equal(lastBadge(), 'URL+', '带前缀复制时角标应是 URL+');

// 3) 双击（450ms 窗口内两次）：第 2 条（默认是空的前缀 + 接 BV 号）
clipboard = [];
badgeTexts = [];
click();
await wait(150);
click();
await settle();
assert.deepEqual(clipboard, [DEFAULT_FIRST + BV, BV], '双击应复制第 2 条（这里等于裸 BV 号）');
assert.equal(lastBadge(), 'BV', '只复制 BV 号时角标应是 BV');

// 4) 两次独立单击（超过双击窗口）：都是第 1 条
clipboard = [];
click();
await wait(600);
click();
await settle();
assert.deepEqual(clipboard, [DEFAULT_FIRST + BV, DEFAULT_FIRST + BV], '两次独立单击都应使用第 1 条');

// 5) 自定义三条线路：菜单只剩第 3 条
setEntries([
  bvEntry('', '复制BV号'),
  urlEntry(SECOND_PREFIX, '第二条'),
  bvEntry(BV_API_PREFIX, '纯K线路'),
]);
await rebuildMenus();
assert.deepEqual(menuIds(), ['prefix:2', 'separator', 'speed-test', 'open-options'], '只有第 3 条进菜单');
assert.equal(menuTitles()[0], '3. 纯K线路 · ckapi.sevenbrothers.cn', '菜单标题用备注 + 主机名');

// 6) 菜单：第 3 条（接 BV 号）
clipboard = [];
chooseMenu('prefix:2');
await settle();
assert.deepEqual(clipboard, [BV_API_PREFIX + BV], '菜单第 3 条应复制「前缀 + BV 号」');

// 7) 双击：第 2 条（接链接）
clipboard = [];
click();
await wait(120);
click();
await settle();
assert.deepEqual(clipboard, [BV, SECOND_PREFIX + PLAIN], '双击应使用第 2 条（接链接）');

// 8) 只剩一条配置：菜单里没有线路项；双击退回裸链接
setEntries([urlEntry(FIRST_PREFIX)]);
await rebuildMenus();
assert.deepEqual(menuIds(), ['separator', 'speed-test', 'open-options'], '只剩一条时菜单没有线路项');
clipboard = [];
click();
await wait(120);
click();
await settle();
assert.deepEqual(clipboard, [FIRST_PREFIX + PLAIN, PLAIN], '第 2 条被删掉后双击退回裸链接');

// 9) 取不到 BV 号时，接 BV 号的配置不复制，并报错角标
pageUrl = 'https://www.bilibili.com/?spm_id_from=333.1';
pageBvid = '';
setEntries([bvEntry(BV_API_PREFIX)]);
clipboard = [];
badgeTexts = [];
click();
await settle();
assert.deepEqual(clipboard, [], '没有 BV 号时不应写入剪贴板');
assert.equal(lastBadge(), '!', '没有 BV 号时应报错角标');

// 10) 非 B 站页面：点击与菜单都不写入剪贴板
pageUrl = 'https://example.com/watch';
setEntries([urlEntry(FIRST_PREFIX), urlEntry(SECOND_PREFIX), urlEntry(THIRD_PREFIX)]);
clipboard = [];
badgeTexts = [];
click();
await settle();
chooseMenu('prefix:2');
await settle();
assert.deepEqual(clipboard, [], '非 B 站页面不应写入剪贴板');
assert.equal(lastBadge(), '!', '非 B 站页面应报错角标');

// 11) av 老链接 + 页面提供 BV 号：升级成 BV 链接后再拼前缀
pageUrl = 'https://www.bilibili.com/video/av170001?spm_id_from=x';
pageBvid = BV;
pagePart = 0;
clipboard = [];
click();
await settle();
assert.deepEqual(clipboard, [`${FIRST_PREFIX}https://www.bilibili.com/video/${BV}`], 'av 链接应升级为 BV 链接');

// 12) 菜单项指向的配置已被删除（下标越界）时不应乱复制
setEntries([urlEntry(FIRST_PREFIX)]);
clipboard = [];
chooseMenu('prefix:2');
await settle();
assert.deepEqual(clipboard, [], '下标越界的菜单项不应写入剪贴板');

// 13) 配置变更后菜单与 tooltip 自动重建
store.clear();
await notifyStorageChange();
await wait(120);
assert.deepEqual(
  menuIds(),
  ['prefix:2', 'prefix:3', 'prefix:4', 'prefix:5', 'prefix:6', 'separator', 'speed-test', 'open-options'],
  '配置变更后菜单应重建',
);
assert.equal(lastTitle(), '单击：后海线路　双击：复制BV号　右键：更多线路 / 测速', 'tooltip 应同步更新');

// 14) 「线路测速…」打开设置页的测速面板
createdTabs = [];
chooseMenu('speed-test');
await settle();
assert.equal(createdTabs.length, 1, '测速菜单应新开设置页');
assert.equal(createdTabs[0].url, 'chrome-extension://test/src/options.html#speed', '应直接定位到测速面板');

// 15) 「设置前缀与备注…」打开设置页
createdTabs = [];
chooseMenu('open-options');
await settle();
assert.equal(createdTabs.length, 1, '设置菜单应新开设置页');
assert.equal(createdTabs[0].url, 'chrome-extension://test/src/options.html', '设置菜单打开列表页');

// 16) 页面浮动按钮：发 copy-first 消息，等同点一下扩展图标
pageUrl = `https://www.bilibili.com/video/${BV}`;
pageBvid = BV;
store.clear();
await rebuildMenus();
await resetClipboard();
let responded = null;
messageHandler({ action: 'copy-first' }, { tab: { id: 7, url: pageUrl } }, (response) => {
  responded = response;
});
await settle();
assert.deepEqual(clipboard, [DEFAULT_FIRST + BV], '页面按钮应复制第 1 条线路');
assert.deepEqual(responded, { ok: true }, '页面按钮应收到回调，用来弹提示');
assert.equal(lastBadge(), 'URL+', '页面按钮复制后角标应同步');

// 17) 页面按钮双击：发 copy-second，复制第 2 条（空前缀 → 裸 BV 号）
await resetClipboard();
responded = null;
messageHandler({ action: 'copy-second' }, { tab: { id: 7, url: pageUrl } }, (response) => {
  responded = response;
});
await settle();
assert.deepEqual(clipboard, [BV], '页面按钮双击应复制第 2 条线路');
assert.deepEqual(responded, { ok: true }, '双击后也应回调页面');
assert.equal(lastBadge(), 'BV', '双击复制 BV 号时角标为 BV');

// 18) 页面按钮右键菜单里的某一条：copy-index 指定下标
await resetClipboard();
responded = null;
messageHandler({ action: 'copy-index', index: 3 }, { tab: { id: 7, url: pageUrl } }, (response) => {
  responded = response;
});
await settle();
assert.deepEqual(clipboard, ['http://ckapi.sevenbrothers.cn/bili/api?id=' + BV], '应按下标复制对应线路');
assert.deepEqual(responded, { ok: true }, '按序号复制也应回调');

// 19) 页面按钮右键：menu 动作返回第 3 条起的菜单数据
let menuPayload = null;
messageHandler({ action: 'menu' }, { tab: { id: 7, url: pageUrl } }, (response) => {
  menuPayload = response;
});
await settle();
assert.equal(menuPayload.ok, true, '菜单数据应返回成功');
assert.equal(menuPayload.items.length, DEFAULT_ENTRIES.length - 2, '菜单应只含第 3 条起的线路');
assert.equal(menuPayload.items[0].index, 2, '菜单第一条的下标是 2');
assert.equal(menuPayload.items[0].title, '3. 智能最快 · 自动挑最快节点', '菜单标题带序号与备注');
assert.deepEqual(menuPayload.items.map((item) => item.index), [2, 3, 4, 5, 6], '菜单下标连续');

// 20) 页面菜单里的「设置 / 测速」：open-options 带锚点
createdTabs = [];
messageHandler({ action: 'open-options', anchor: 'speed' }, { tab: { id: 7, url: pageUrl } }, () => {});
await settle();
assert.equal(createdTabs.length, 1, '页面菜单的测速项应新开设置页');
assert.equal(createdTabs[0].url, 'chrome-extension://test/src/options.html#speed', '应定位到测速面板');

console.log('点击流仿真测试全部通过 ✔');
process.exit(0);
