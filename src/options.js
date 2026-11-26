import { applyPrefix, normalizeBvid } from './lib/bili.js';
import {
  DEFAULT_ENTRIES,
  DOUBLE_INDEX,
  ENTRY_TYPE_API,
  ENTRY_TYPE_AUTO,
  ENTRY_TYPE_BV,
  ENTRY_TYPE_URL,
  MAX_ENTRIES,
  MENU_START_INDEX,
  NOTE_MAX_LENGTH,
  SAMPLE_BV_PREFIX,
  SINGLE_INDEX,
  entryMenuTitle,
  entryRoleClass,
  entryRoleLabel,
  loadEntries,
  loadSpeedConfig,
  loadSpeedResult,
  saveEntries,
  saveSpeedConfig,
  saveSpeedResult,
} from './lib/settings.js';
import {
  DEFAULT_SPEED_CONFIG,
  DEFAULT_TEST_BV,
  GRADES,
  SPEED_DEPTHS,
  formatMbps,
  formatMs,
  gradeLatency,
  gradeSpeed,
  runSpeedTest,
} from './lib/speedtest.js';

/** 预览用的示例数据（实际使用时替换成当前页面）。 */
const SAMPLE_LINK = 'https://www.bilibili.com/video/BV1fMYi6EEaP';
const SAMPLE_BV = 'BV1fMYi6EEaP';

const list = document.getElementById('list');
const addButton = document.getElementById('add');
const resetButton = document.getElementById('reset');
const status = document.getElementById('status');
const previewSingle = document.getElementById('preview-single');
const previewDouble = document.getElementById('preview-double');
const previewMenu = document.getElementById('preview-menu');

const speedSection = document.getElementById('speed');
const speedBvInput = document.getElementById('speed-bv');
const speedDepthSelect = document.getElementById('speed-depth');
const speedRunButton = document.getElementById('speed-run');
const speedViewButton = document.getElementById('speed-view');
const speedStopButton = document.getElementById('speed-stop');
const speedStatus = document.getElementById('speed-status');
const speedResultBox = document.getElementById('speed-result');

/** @type {{ type: 'url'|'bv', value: string, note: string }[]} */
let entries = [];
let saveTimer = null;
let statusTimer = null;

/** 测速状态 */
let speedConfig = { ...DEFAULT_SPEED_CONFIG };
let speedResultData = null;
let speedRunning = false;
let speedAbort = null;

/* ---------------- 列表渲染 ---------------- */

function buildToolButton(label, title, onClick, disabled) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.title = title;
  button.disabled = disabled;
  button.addEventListener('click', onClick);
  return button;
}

function placeholderFor(entry) {
  if (entry.type === ENTRY_TYPE_AUTO) return '这条不用填前缀，点一下自动挑最快的 CDN 直链';
  if (entry.type === ENTRY_TYPE_API) return '填返回 JSON 的解析接口，例如 https://api.squidtail.com/bili2vrc/parse/';
  // 空着就是「只在本地复制」，把这句话直接写在输入框里，省得再去猜它干嘛的。
  if (!entry.value) return '输入解析站前缀链接，空着为复制BV号';
  return entry.type === ENTRY_TYPE_BV ? SAMPLE_BV_PREFIX : DEFAULT_ENTRIES[5].value;
}

function buildRow(entry, index) {
  const row = document.createElement('div');
  row.className = 'entry';

  const order = document.createElement('span');
  order.className = 'idx';
  order.textContent = String(index + 1);

  const type = document.createElement('select');
  type.title = '前缀后面接什么';
  for (const [value, label] of [
    [ENTRY_TYPE_URL, '接有效链接'],
    [ENTRY_TYPE_BV, '接 BV 号'],
    [ENTRY_TYPE_AUTO, '智能最快节点'],
    [ENTRY_TYPE_API, '解析接口（JSON）'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    type.append(option);
  }
  type.value = entry.type;

  const input = document.createElement('input');
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.dataset.role = 'value';
  input.value = entry.value;
  input.disabled = entry.type === ENTRY_TYPE_AUTO;
  input.placeholder = placeholderFor(entry);
  input.addEventListener('input', () => {
    entries[index] = { ...entries[index], value: input.value };
    renderPreview();
    scheduleSave();
  });
  input.addEventListener('blur', flushSave);

  const note = document.createElement('input');
  note.type = 'text';
  note.autocomplete = 'off';
  note.dataset.role = 'note';
  note.maxLength = NOTE_MAX_LENGTH;
  note.placeholder = '备注';
  note.title = '备注：显示在右键菜单和图标提示里';
  note.value = entry.note || '';
  note.addEventListener('input', () => {
    entries[index] = { ...entries[index], note: note.value };
    renderPreview();
    scheduleSave();
  });
  note.addEventListener('blur', flushSave);

  type.addEventListener('change', () => {
    const nextType = type.value;
    // 切到「智能最快」时把前缀清空：这一条不用前缀，留着反而会让人以为它还在用。
    entries[index] = {
      ...entries[index],
      type: nextType,
      value: nextType === ENTRY_TYPE_AUTO ? '' : entries[index].value,
    };
    input.value = entries[index].value;
    input.disabled = nextType === ENTRY_TYPE_AUTO;
    input.placeholder = placeholderFor(entries[index]);
    renderPreview();
    scheduleSave();
  });

  const role = document.createElement('span');
  role.className = `role ${entryRoleClass(index)}`;
  role.textContent = entryRoleLabel(index);
  role.title =
    index === SINGLE_INDEX
      ? '单击扩展图标时使用这一条'
      : index === DOUBLE_INDEX
        ? '双击扩展图标时使用这一条'
        : '出现在右键菜单里';

  const tools = document.createElement('div');
  tools.className = 'tools';
  tools.append(
    buildToolButton('↑', '上移', () => moveEntry(index, -1), index === 0),
    buildToolButton('↓', '下移', () => moveEntry(index, 1), index === entries.length - 1),
    buildToolButton('删除', '删除这一条', () => removeEntry(index), entries.length === 1),
  );

  row.append(order, type, input, note, role, tools);
  return row;
}

function renderList() {
  list.textContent = '';
  entries.forEach((entry, index) => list.append(buildRow(entry, index)));
  addButton.disabled = entries.length >= MAX_ENTRIES;
}

/* ---------------- 预览 ---------------- */

/** 按配置项算出真实复制结果。 */
function previewOf(entry) {
  if (entry.type === ENTRY_TYPE_AUTO) return '⚡ 自动挑选最快的 CDN 直链（用上次测速的排名）';
  if (entry.type === ENTRY_TYPE_API) {
    return `${entry.value || 'https://…/parse/'}?bv=${SAMPLE_BV}&p=1&format=mp4&otype=json → 读出 JSON 里的 url`;
  }
  const base = entry.type === ENTRY_TYPE_BV ? SAMPLE_BV : SAMPLE_LINK;
  return applyPrefix(entry.value, base) || base;
}

function menuPreviewItem(name, value) {
  const item = document.createElement('div');
  item.className = 'item';

  const label = document.createElement('span');
  label.className = 'name';
  label.textContent = name;

  const code = document.createElement('code');
  code.textContent = value;

  item.append(label, code);
  return item;
}

function renderPreview() {
  const single = entries[SINGLE_INDEX];
  previewSingle.textContent = single ? previewOf(single) : SAMPLE_LINK;

  const double = entries[DOUBLE_INDEX];
  previewDouble.textContent = double
    ? previewOf(double)
    : `${SAMPLE_LINK}（第 2 条已删除，双击退回裸链接）`;

  previewMenu.textContent = '';
  entries.slice(MENU_START_INDEX).forEach((entry, offset) => {
    const index = offset + MENU_START_INDEX;
    previewMenu.append(menuPreviewItem(entryMenuTitle(entry, index), previewOf(entry)));
  });
  if (entries.length <= MENU_START_INDEX) {
    const tip = document.createElement('div');
    tip.className = 'empty';
    tip.textContent = '（第 3 条起才会进右键菜单，现在还没有）';
    previewMenu.append(tip);
  }
}

/* ---------------- 增删改 ---------------- */

function moveEntry(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= entries.length) return;
  const [moved] = entries.splice(index, 1);
  entries.splice(target, 0, moved);
  renderList();
  renderPreview();
  scheduleSave();
}

function removeEntry(index) {
  if (entries.length <= 1) return;
  entries.splice(index, 1);
  renderList();
  renderPreview();
  scheduleSave();
}

function addEntry() {
  if (entries.length >= MAX_ENTRIES) return;
  entries.push({ type: ENTRY_TYPE_BV, value: '', note: '' });
  renderList();
  renderPreview();
  scheduleSave();
  const inputs = list.querySelectorAll('input[data-role="value"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

/* ---------------- 保存 ---------------- */

function flash(message) {
  if (statusTimer) clearTimeout(statusTimer);
  status.textContent = message;
  statusTimer = setTimeout(() => {
    statusTimer = null;
    status.textContent = '';
  }, 2000);
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 400);
}

function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  saveNow();
}

async function saveNow() {
  const ok = await saveEntries(entries);
  flash(ok ? '已保存' : '保存失败');
}

/* ---------------- 测速：结果渲染 ---------------- */

function setSpeedStatus(text, tone = '') {
  speedStatus.textContent = text;
  speedStatus.className = `speed-status${tone ? ` ${tone}` : ''}`;
}

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '未知时间';
  return date.toLocaleString('zh-CN', { hour12: false });
}

/** upos-sz-estgoss.bilivideo.com → estgoss，方便在一列里看。 */
function shortHost(host) {
  return String(host || '')
    .replace(/\.(bilivideo\.com|bilivideo\.cn|akamaized\.net|bilivideo\.com\.cn)$/i, '')
    .replace(/^upos-/, '')
    .replace(/^sz-/, '')
    .replace(/^hz-/, '');
}

function gradeOf(line) {
  if (line.state === 'skipped') return 'skipped';
  if (line.state !== 'ok') return 'fail';
  if (line.bestCdn && Number.isFinite(line.bestCdn.mbps)) return gradeSpeed(line.bestCdn.mbps);
  return 'unknown';
}

function gradeNode(key) {
  const grade = GRADES[key] || GRADES.unknown;
  const span = document.createElement('span');
  span.className = `grade tone-${grade.tone}`;
  span.textContent = `${grade.icon} ${grade.label}`;
  return span;
}

function textCell(text, className) {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

function connectivityNode(line) {
  const span = document.createElement('span');
  span.className = 'num';
  if (line.state === 'skipped') {
    span.textContent = '➖';
    span.title = line.reason || '不联网';
  } else if (line.state === 'ok') {
    const slow = Number.isFinite(line.latencyMs) && line.latencyMs > 2000;
    span.textContent = slow ? '⚠️' : '✅';
    span.title = slow ? '能通，但解析站响应偏慢' : '连通正常';
  } else if (line.state === 'running' || line.state === 'pending') {
    span.textContent = '⏳';
    span.title = '正在测';
  } else {
    span.textContent = '❌';
    span.title = line.reason || '测不通';
  }
  return span;
}

function detailRow(line) {
  const tr = document.createElement('tr');
  tr.className = 'detail';
  const td = document.createElement('td');
  td.colSpan = 7;

  const nodes = Array.isArray(line.cdn) ? line.cdn : [];
  const totalHits = Number.isFinite(line.hits) ? line.hits : 0;
  if (!nodes.length) {
    td.textContent = line.reason || (line.state === 'skipped' ? line.reason || '不联网' : '没有解析出可用的 CDN 地址');
  } else {
    for (const node of nodes) {
      const chip = document.createElement('span');
      chip.className = 'cdn-chip';
      // 出现概率：这条线路的样本里有几次落到了这个节点。
      const odds = totalHits && Number.isFinite(node.hits)
        ? ` · 出现 ${node.hits}/${totalHits} 轮（${node.pct ?? 0}%）`
        : '';
      const parsed = node.error
        ? `${formatMbps(null)}（${node.error}）`
        : `${formatMbps(node.mbps)} · CDN 延迟 ${formatMs(node.ttfbMs)}`;
      chip.textContent = `${node.host} — ${parsed}${odds}`;
      td.append(chip);
    }
    if (line.samples?.length) {
      const successful = line.samples.filter((sample) => sample.ok).length;
      const info = document.createElement('span');
      info.className = 'cdn-chip cdn-summary';
      info.textContent = `（测 ${line.samples.length} 次，成功 ${successful} 次，共 ${line.hosts?.length || 0} 个节点）`;
      td.append(info);
    }
  }
  tr.append(td);
  return tr;
}

/**
 * 渲染测速结果表（实时进度与历史结果共用）。
 * @param {Array} lines 线路结果
 * @param {{ summaryItems?: [string,string][], notes?: string[] }} extra
 */
function renderSpeedLines(lines, { summaryItems = [], notes = [] } = {}) {
  speedResultBox.textContent = '';

  if (!lines || !lines.length) {
    const empty = document.createElement('p');
    empty.className = 'speed-empty';
    empty.textContent = '还没有测速记录，点「开始测速」跑一轮；结果会自动保留，下次也能看到。';
    speedResultBox.append(empty);
    return;
  }

  if (summaryItems.length) {
    const summary = document.createElement('div');
    summary.className = 'speed-summary';
    for (const [key, value] of summaryItems) {
      const item = document.createElement('span');
      const strong = document.createElement('b');
      strong.textContent = `${key} `;
      item.append(strong, document.createTextNode(value));
      summary.append(item);
    }
    speedResultBox.append(summary);
  }

  // 空前缀 / 智能最快这类条目不参与测速，表格里不占一行，免得看着杂乱。
  const visibleLines = lines.filter((line) => line.state !== 'skipped');
  if (!visibleLines.length) {
    const empty = document.createElement('p');
    empty.className = 'speed-empty';
    empty.textContent = '没有需要测速的线路：填空的条目和「智能最快」本来就不联网。给某条线路填入前缀链接后再测。';
    speedResultBox.append(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'speed-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const columns = [
    ['线路', '备注 · 解析站域名'],
    ['连通', '这条线路能不能用'],
    ['解析延迟', '等解析站给地址要多久 → 决定点开后等多久'],
    ['节点数', '这条线路一共给出过几个 CDN 节点'],
    ['最快节点', '这条线路里下载最快的节点'],
    ['CDN 延迟', '拿到地址后等第一帧要多久 → 决定起播快不快'],
    ['评级', '按最快节点的下载速度评的档'],
  ];
  for (const [title, tip] of columns) {
    const th = document.createElement('th');
    th.textContent = title;
    th.title = tip;
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const line of visibleLines) {
    const tr = document.createElement('tr');
    tr.dataset.index = String(line.index);

    const nameCell = document.createElement('td');
    const name = document.createElement('span');
    name.className = 'line-name';
    name.textContent = line.note || `第 ${line.index + 1} 条`;
    const host = document.createElement('span');
    host.className = 'line-host';
    host.textContent = line.host || (line.state === 'skipped' ? '空前缀（只复制，不联网）' : '');
    nameCell.append(name, host);

    const latency = Number.isFinite(line.latencyMs) ? formatMs(line.latencyMs) : '—';
    const latencyCell = textCell(latency, 'num');
    latencyCell.title = line.latencyMs
      ? `线路解析延迟：解析站回 302 用了 ${formatMs(line.latencyMs)}（${gradeLatency(line.latencyMs)}）`
      : line.reason || '';

    const nodeCount = Array.isArray(line.hosts) && line.hosts.length ? `${line.hosts.length} 个` : '—';

    const bestCell = document.createElement('td');
    bestCell.className = 'num';
    if (line.bestCdn && Number.isFinite(line.bestCdn.mbps)) {
      bestCell.textContent = `${shortHost(line.bestCdn.host)} · ${formatMbps(line.bestCdn.mbps)}`;
      bestCell.title = `${line.bestCdn.host}\nCDN 延迟 ${formatMs(line.bestCdn.ttfbMs)}`;
    } else {
      bestCell.textContent = '—';
    }

    const ttfb = line.bestCdn && Number.isFinite(line.bestCdn.ttfbMs) ? formatMs(line.bestCdn.ttfbMs) : '—';
    // 这一列指的是「最快那个 CDN」的首包时间，不是解析站的。
    const gradeCell = document.createElement('td');
    gradeCell.className = 'grade';
    gradeCell.append(gradeNode(gradeOf(line)));

    tr.append(
      nameCell,
      (() => {
        const td = document.createElement('td');
        td.append(connectivityNode(line));
        return td;
      })(),
      latencyCell,
      textCell(nodeCount, 'num'),
      bestCell,
      textCell(ttfb, 'num'),
      gradeCell,
    );
    tbody.append(tr);

    if (line.state !== 'skipped') tbody.append(detailRow(line));
  }
  table.append(tbody);
  speedResultBox.append(table);

  const legend = document.createElement('p');
  legend.className = 'speed-legend';
  legend.textContent = '「解析延迟」和「CDN 延迟」是两个阶段：前者等地址，后者等画面。展开行里的「出现 x/y 轮」= 测 y 次有 x 次落到这个节点。';
  speedResultBox.append(legend);

  if (notes.length) {
    const noteList = document.createElement('ul');
    noteList.className = 'hint';
    for (const note of notes) {
      const item = document.createElement('li');
      item.textContent = note;
      noteList.append(item);
    }
    speedResultBox.append(noteList);
  }
}

function renderSpeedResult(result) {
  if (!result) {
    renderSpeedLines([], {});
    return;
  }
  const summary = result.summary || {};
  const items = [
    ['测试时间', formatWhen(result.finishedAt || result.startedAt)],
    ['测试 BV', result.bv || ''],
    ['探测轮次', SPEED_DEPTHS[result.depth]?.label || `${result.rounds || 0} 轮`],
    ['用时', `${((result.durationMs || 0) / 1000).toFixed(1)} 秒`],
    ['可用线路', `${summary.ok ?? 0}/${summary.testable ?? 0}`],
    [
      '最快节点',
      summary.bestHost ? `${summary.bestHost} · ${formatMbps(summary.bestMbps)}` : '—',
    ],
  ];
  renderSpeedLines(result.lines || [], { summaryItems: items, notes: result.notes || [] });
}

/* ---------------- 测速：执行 ---------------- */

/** 必须在点击事件的同一个任务里调用，request() 依赖用户手势。 */
async function ensureHostPermission() {
  if (typeof chrome === 'undefined' || !chrome.permissions) return true;
  try {
    return await chrome.permissions.request({ origins: ['<all_urls>'] });
  } catch {
    return false;
  }
}

function renderSpeedProgress(event, startedAt) {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (event.phase === 'resolve') {
    setSpeedStatus(`正在测解析站… ${event.done}/${event.total} 条线路 · 已用时 ${elapsed} 秒`);
  } else if (event.phase === 'cdn') {
    setSpeedStatus(`正在测 CDN 延迟与下载速率… ${event.done}/${event.total} 个节点 · 已用时 ${elapsed} 秒`);
  }
}

async function startSpeedTest() {
  if (speedRunning) return;

  const bv = normalizeBvid(speedBvInput.value);
  if (!bv) {
    setSpeedStatus('测试 BV 号格式不对：应该是 BV + 10 位字母数字，例如 BV1AM4y1M71p。', 'warn');
    return;
  }

  // 授权放在最前面：permissions.request() 必须在用户手势还活着的时候调用。
  const granted = await ensureHostPermission();
  if (!granted) {
    setSpeedStatus('没有「访问网站」权限就没法直接从浏览器测速。再点一次「开始测速」并在弹窗里允许即可。', 'warn');
    return;
  }

  flushSave();
  speedConfig = {
    bv,
    depth: Object.hasOwn(SPEED_DEPTHS, speedDepthSelect.value)
      ? speedDepthSelect.value
      : DEFAULT_SPEED_CONFIG.depth,
  };
  speedBvInput.value = bv;
  saveSpeedConfig(speedConfig);

  speedRunning = true;
  speedRunButton.disabled = true;
  speedStopButton.hidden = false;
  speedAbort = new AbortController();
  const startedAt = Date.now();
  setSpeedStatus('正在准备…');

  try {
    const result = await runSpeedTest({
      entries,
      bv,
      depth: speedConfig.depth,
      signal: speedAbort.signal,
      onProgress: (event) => {
        renderSpeedProgress(event, startedAt);
        if (event.phase !== 'done') renderSpeedLines(event.lines, {});
      },
    });
    speedResultData = result;
    await saveSpeedResult(result);
    renderSpeedResult(result);
    setSpeedStatus(
      `测速完成：${result.summary.ok}/${result.summary.testable} 条线路可用，用时 ${(result.durationMs / 1000).toFixed(1)} 秒。`,
      result.summary.ok ? 'ok' : 'warn',
    );
  } catch (error) {
    setSpeedStatus(`测速中断：${error?.message || error}`, 'warn');
  } finally {
    speedRunning = false;
    speedRunButton.disabled = false;
    speedStopButton.hidden = true;
    speedAbort = null;
  }
}

/* ---------------- 事件绑定 ---------------- */

addButton.addEventListener('click', addEntry);

resetButton.addEventListener('click', async () => {
  entries = DEFAULT_ENTRIES.map((entry) => ({ ...entry }));
  renderList();
  renderPreview();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const ok = await saveEntries(entries);
  flash(ok ? '已恢复默认配置' : '保存失败');
});

speedRunButton.addEventListener('click', () => {
  startSpeedTest();
});

speedStopButton.addEventListener('click', () => {
  speedAbort?.abort();
  setSpeedStatus('已停止。', 'warn');
});

speedViewButton.addEventListener('click', () => {
  if (speedRunning) {
    setSpeedStatus('测速正在进行中，等它跑完就能看到最新结果。');
    return;
  }
  renderSpeedResult(speedResultData);
  setSpeedStatus(
    speedResultData
      ? `上次测速：${formatWhen(speedResultData.finishedAt)}（${speedResultData.bv}）`
      : '还没有测速记录，点「开始测速」跑一轮。',
  );
  speedSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

speedDepthSelect.addEventListener('change', () => {
  saveSpeedConfig({ bv: speedBvInput.value, depth: speedDepthSelect.value });
});

window.addEventListener('beforeunload', flushSave);

/* ---------------- 初始化 ---------------- */

for (const [key, definition] of Object.entries(SPEED_DEPTHS)) {
  const option = document.createElement('option');
  option.value = key;
  option.textContent = definition.label;
  speedDepthSelect.append(option);
}

entries = await loadEntries();
renderList();
renderPreview();

speedConfig = await loadSpeedConfig({ bv: DEFAULT_TEST_BV, depth: DEFAULT_SPEED_CONFIG.depth });
speedBvInput.value = normalizeBvid(speedConfig.bv) || DEFAULT_TEST_BV;
speedDepthSelect.value = Object.hasOwn(SPEED_DEPTHS, speedConfig.depth)
  ? speedConfig.depth
  : DEFAULT_SPEED_CONFIG.depth;

speedResultData = await loadSpeedResult();
if (speedResultData) {
  renderSpeedResult(speedResultData);
  setSpeedStatus(
    `已载入上次测速结果（${formatWhen(speedResultData.finishedAt)}）。点「开始测速」可以重新跑一轮。`,
  );
} else {
  renderSpeedLines([], {});
}

if (location.hash === '#speed') {
  speedSection.scrollIntoView({ block: 'start' });
}
