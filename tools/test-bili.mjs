import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPrefix,
  buildShortUrl,
  extractBvid,
  isBilibiliUrl,
  isBilibiliVideoPage,
  normalizeBvid,
} from '../src/lib/bili.js';
import {
  DEFAULT_ENTRIES,
  MENU_START_INDEX,
  SINGLE_INDEX,
  DOUBLE_INDEX,
  backfillNotes,
  entryHostHint,
  entryMenuTitle,
  entryRoleClass,
  entryRoleLabel,
  entrySummary,
  normalizeEntries,
  normalizeEntry,
} from '../src/lib/settings.js';

const BV = 'BV1fMYi6EEaP';
const CANON = `https://www.bilibili.com/video/${BV}`;

test('从各种文本 / URL 中提取 BV 号', () => {
  assert.equal(extractBvid(`${CANON}?spm_id_from=333.999.0.0&vd_source=abc`), BV);
  assert.equal(extractBvid('https://www.bilibili.com/video/BV1fMYi6EEaP/?p=2'), BV);
  assert.equal(extractBvid('https://www.bilibili.com/list/watchlater?bvid=BV1fMYi6EEaP'), BV);
  assert.equal(extractBvid('https://www.bilibili.com/video/av170001'), null);
  assert.equal(extractBvid(''), null);
});

test('BV 号校验与标准化', () => {
  assert.equal(normalizeBvid('bv1fmyi6eeap'), null);
  assert.equal(normalizeBvid(BV), BV);
  assert.equal(normalizeBvid(`${BV} `), BV);
  assert.equal(normalizeBvid('BV1fMYi6EEa'), null);
  assert.equal(normalizeBvid(123), null);
});

test('视频页取最短链接：去掉所有追踪参数', () => {
  assert.equal(buildShortUrl(`${CANON}?spm_id_from=333.999.0.0&vd_source=9d1c0f#reply`), CANON);
});

test('视频页保留分 P 信息，p=1 不写入', () => {
  assert.equal(buildShortUrl(`${CANON}/?p=1&vd_source=x`), CANON);
  assert.equal(buildShortUrl(`${CANON}?p=3&spm_id_from=x`), `${CANON}?p=3`);
  assert.equal(buildShortUrl(`${CANON}?spm_id_from=x`, { p: 4 }), `${CANON}?p=4`);
});

test('移动端 / 裸域 / 缺协议头都归一化到 www', () => {
  assert.equal(buildShortUrl(`https://m.bilibili.com/video/${BV}?p=2&share_source=copy_web`), `${CANON}?p=2`);
  assert.equal(buildShortUrl(`bilibili.com/video/${BV}`), CANON);
  assert.equal(buildShortUrl(`www.bilibili.com/video/${BV}`), CANON);
});

test('av 老链接：页面提供 BV 号时升级为 BV 链接', () => {
  assert.equal(
    buildShortUrl('https://www.bilibili.com/video/av170001?spm_id_from=x', { bvid: BV }),
    CANON,
  );
  assert.equal(
    buildShortUrl('https://www.bilibili.com/video/av170001?spm_id_from=x'),
    'https://www.bilibili.com/video/av170001',
  );
});

test('番剧页：ep 直链，ss 页可用页面集号定位', () => {
  assert.equal(
    buildShortUrl('https://www.bilibili.com/bangumi/play/ep123456?from_spmid=x&share_source=copy_web'),
    'https://www.bilibili.com/bangumi/play/ep123456',
  );
  assert.equal(
    buildShortUrl('https://www.bilibili.com/bangumi/play/ss28747?spm_id_from=x', { epId: 'ep123456' }),
    'https://www.bilibili.com/bangumi/play/ep123456',
  );
  assert.equal(
    buildShortUrl('https://www.bilibili.com/bangumi/play/ss28747?spm_id_from=x'),
    'https://www.bilibili.com/bangumi/play/ss28747',
  );
});

test('官方短链 b23.tv 保持原样，仅去掉查询串', () => {
  assert.equal(buildShortUrl('https://b23.tv/AbCdEf?share_source=copy_web'), 'https://b23.tv/AbCdEf');
  assert.equal(buildShortUrl('https://b23.tv/AbCdEf/'), 'https://b23.tv/AbCdEf');
});

test('列表页带 bvid 时换成那条视频的链接（贴进 VRChat 才能被解析）', () => {
  assert.equal(
    buildShortUrl('https://www.bilibili.com/list/watchlater?bvid=BV1fMYi6EEaP&spm_id_from=333.1007'),
    `https://www.bilibili.com/video/${BV}`,
  );
  assert.equal(
    buildShortUrl('https://www.bilibili.com/list/ml123456?bvid=BV1fMYi6EEaP&p=3'),
    `https://www.bilibili.com/video/${BV}?p=3`,
    '列表里带分P时保留 p',
  );
  assert.equal(
    buildShortUrl('https://www.bilibili.com/list/watchlater'),
    'https://www.bilibili.com/list/watchlater',
    '没带 bvid 的列表页保持原样',
  );
});

test('直播页：统一成房间号链接，去掉追踪参数和分区前缀', () => {
  assert.equal(
    buildShortUrl('https://live.bilibili.com/22603245?spm_id_from=333.1&broadcast_type=0'),
    'https://live.bilibili.com/22603245',
  );
  assert.equal(buildShortUrl('https://live.bilibili.com/blanc/12345?room_id=12345'), 'https://live.bilibili.com/12345');
  assert.equal(buildShortUrl('https://live.bilibili.com/'), 'https://live.bilibili.com/');
});

test('非播放页：清追踪参数但保留业务参数与子域名', () => {
  assert.equal(
    buildShortUrl('https://space.bilibili.com/123/dynamic?spm_id_from=x&tab=video'),
    'https://space.bilibili.com/123/dynamic?tab=video',
  );
  assert.equal(
    buildShortUrl('https://live.bilibili.com/123?broadcast_type=0&is_room_feed=0'),
    'https://live.bilibili.com/123',
  );
  assert.equal(
    buildShortUrl('https://search.bilibili.com/all?keyword=BV1fMYi6EEaP&spm_id_from=333'),
    'https://search.bilibili.com/all?keyword=BV1fMYi6EEaP',
  );
  assert.equal(buildShortUrl('https://www.bilibili.com/?spm_id_from=333.1'), 'https://www.bilibili.com/');
});

test('非 B 站链接一律返回 null', () => {
  assert.equal(buildShortUrl('https://www.youtube.com/watch?v=abc'), null);
  assert.equal(buildShortUrl('https://example.com/video/BV1fMYi6EEaP'), null);
  assert.equal(buildShortUrl('not a url'), null);
  assert.equal(buildShortUrl(''), null);
  assert.equal(buildShortUrl(null), null);
});

test('域名识别与播放页识别', () => {
  assert.equal(isBilibiliUrl(CANON), true);
  assert.equal(isBilibiliUrl('https://b23.tv/AbCdEf'), true);
  assert.equal(isBilibiliUrl('https://example.com'), false);
  assert.equal(isBilibiliVideoPage(`${CANON}?p=2`), true);
  assert.equal(isBilibiliVideoPage('https://www.bilibili.com/bangumi/play/ep123456'), true);
  assert.equal(isBilibiliVideoPage('https://space.bilibili.com/123'), false);
  assert.equal(isBilibiliVideoPage('https://example.com/video/BV1fMYi6EEaP'), false);
});

test('前缀拼接：默认播放器前缀', () => {
  assert.equal(
    applyPrefix('https://biliplayer.91vrchat.com/player/?url=', CANON),
    `https://biliplayer.91vrchat.com/player/?url=${CANON}`,
  );
});

test('前缀拼接：空前缀退回裸链接', () => {
  assert.equal(applyPrefix('', CANON), CANON);
  assert.equal(applyPrefix(null, CANON), CANON);
  assert.equal(applyPrefix(undefined, CANON), CANON);
});

test('前缀拼接：原样保留空格等字符，不做转义', () => {
  assert.equal(applyPrefix('看看这个 ', CANON), `看看这个 ${CANON}`);
  assert.equal(applyPrefix('a&b=', CANON), `a&b=${CANON}`);
});

test('前缀拼接：支持 {url} / {bv} 占位符', () => {
  assert.equal(applyPrefix('bv={bv}&url={url}', CANON), `bv=${BV}&url=${CANON}`);
  assert.equal(
    applyPrefix('https://x.com/?u={url}&t=1', CANON),
    `https://x.com/?u=${CANON}&t=1`,
  );
  assert.equal(applyPrefix('{url}{url}', CANON), CANON + CANON);
});

test('前缀拼接：链接为空时返回 null', () => {
  assert.equal(applyPrefix('x', ''), null);
  assert.equal(applyPrefix('x', null), null);
});

test('右键菜单条目名：带序号、去掉协议、区分类型、过长截断', () => {
  const link = { type: 'url', value: 'https://biliplayer.91vrchat.com/player/?url=' };
  assert.equal(entryMenuTitle(link, 1), '2. biliplayer.91vrchat.com/player/?url=');
  assert.equal(entryMenuTitle({ type: 'bv', value: 'http://ckapi.sevenbrothers.cn/bili/api?id=' }, 1), '2. [BV] ckapi.sevenbrothers.cn/bili/api?id=');
  assert.equal(entryMenuTitle({ type: 'url', value: '' }, 2), '3. 复制裸链接');
  assert.equal(entryMenuTitle({ type: 'bv', value: '' }, 0), '1. 复制 BV 号');
  const long = entryMenuTitle({ type: 'url', value: `https://example.com/${'x'.repeat(60)}` }, 1);
  assert.equal(long.length, 43);
  assert.equal(long.endsWith('…'), true);
});

test('默认配置：7 条线路，第 3 条是「智能最快节点」', () => {
  assert.equal(DEFAULT_ENTRIES.length, 7);
  assert.deepEqual(
    DEFAULT_ENTRIES.map((entry) => entry.type),
    ['bv', 'bv', 'auto', 'bv', 'bv', 'bv', 'bv'],
    '第 3 条是智能条目，其余都是「接 BV 号」',
  );
  assert.deepEqual(
    DEFAULT_ENTRIES.map((entry) => entry.value),
    [
      'https://api.xuan25.com/bili-resolve/',
      '',
      '',
      'http://ckapi.sevenbrothers.cn/bili/api?id=',
      'https://bil.ouo.chat/player/?url=',
      'https://biliplayer.91vrchat.com/player/?url=',
      'https://ktv.chiooone.com/player/?url=',
    ],
  );
  assert.deepEqual(DEFAULT_ENTRIES.map((entry) => entry.note), [
    '后海线路',
    '复制BV号',
    '智能最快',
    '纯K线路',
    '星流线路',
    '孤线路',
    '暖夜线路',
  ]);
});

test('位置决定用途：第 1 条单击、第 2 条双击、第 3 条起右键菜单', () => {
  assert.equal(SINGLE_INDEX, 0);
  assert.equal(DOUBLE_INDEX, 1);
  assert.equal(MENU_START_INDEX, 2);
  assert.equal(entryRoleLabel(0), '单击');
  assert.equal(entryRoleLabel(1), '双击');
  assert.equal(entryRoleLabel(2), '菜单');
  assert.equal(entryRoleClass(0), 'primary');
  assert.equal(entryRoleClass(1), 'secondary');
  assert.equal(entryRoleClass(2), 'menu');
});

test('菜单标题优先用备注，并带上主机名方便区分', () => {
  assert.equal(
    entryMenuTitle({ type: 'bv', value: 'https://api.xuan25.com/bili-resolve/', note: '后海线路' }, 2),
    '3. 后海线路 · api.xuan25.com',
  );
  assert.equal(entryMenuTitle({ type: 'bv', value: '', note: '复制BV号' }, 1), '2. 复制BV号');
  assert.equal(
    entryMenuTitle({ type: 'auto', value: '', note: '智能最快' }, 2),
    '3. 智能最快 · 自动挑最快节点',
    '智能条目的菜单名要说明它会自动挑节点',
  );
  assert.equal(
    entryMenuTitle({ type: 'bv', value: 'http://ckapi.sevenbrothers.cn/bili/api?id=', note: ' 纯K线路 ' }, 2),
    '3. 纯K线路 · ckapi.sevenbrothers.cn',
    '备注应去掉首尾空格',
  );
  const weird = entryMenuTitle({ type: 'url', value: 'not a url at all', note: '' }, 2);
  assert.equal(weird.startsWith('3. '), true);
});

test('主机名提取与一句话摘要', () => {
  assert.equal(entryHostHint({ value: 'https://biliplayer.91vrchat.com/player/?url=' }), 'biliplayer.91vrchat.com');
  assert.equal(entryHostHint({ value: 'https://www.bilibili.com/video/' }), 'bilibili.com');
  assert.equal(entryHostHint({ value: '' }), '');
  assert.equal(entrySummary({ type: 'bv', value: '', note: '' }), '复制 BV 号');
  assert.equal(entrySummary({ type: 'url', value: '', note: '' }), '复制裸链接');
  assert.equal(entrySummary({ type: 'bv', value: 'https://api.xuan25.com/x/', note: '后海线路' }), '后海线路');
  assert.equal(entrySummary({ type: 'bv', value: 'https://api.xuan25.com/x/', note: '' }), 'api.xuan25.com');
  assert.equal(entrySummary({ type: 'auto', value: '', note: '' }), '智能最快');
});

test('归一化：保留并裁剪备注，非法项回退', () => {
  assert.deepEqual(normalizeEntry('x'), { type: 'url', value: 'x', note: '' });
  assert.deepEqual(normalizeEntry({ type: 'bv', value: 'v', note: '  备注  ' }), {
    type: 'bv',
    value: 'v',
    note: '备注',
  });
  assert.deepEqual(normalizeEntry({ type: 'zzz', value: 'v' }), { type: 'url', value: 'v', note: '' });
  assert.deepEqual(
    normalizeEntry({ type: 'auto', value: 'https://leftover.example/', note: '智能' }),
    { type: 'auto', value: '', note: '智能' },
    '智能条目不应保留前缀',
  );
  assert.equal(normalizeEntry(42), null);
  const longNote = normalizeEntry({ type: 'bv', value: 'v', note: '备'.repeat(80) });
  assert.equal(longNote.note.length, 24, '备注应截断到 24 个字');
  assert.deepEqual(normalizeEntries([]), DEFAULT_ENTRIES, '空列表回退默认配置');
});

test('旧配置按 value 自动补默认备注', () => {
  const old = [
    { type: 'bv', value: 'https://api.xuan25.com/bili-resolve/', note: '' },
    { type: 'bv', value: 'https://my.own.site/?u=', note: '' },
    { type: 'bv', value: 'http://ckapi.sevenbrothers.cn/bili/api?id=', note: '我改过' },
  ];
  const filled = backfillNotes(old);
  assert.equal(filled.changed, true);
  assert.equal(filled.list[0].note, '后海线路');
  assert.equal(filled.list[1].note, '', '不认识的线路不瞎填');
  assert.equal(filled.list[2].note, '我改过', '已有备注不覆盖');
});
