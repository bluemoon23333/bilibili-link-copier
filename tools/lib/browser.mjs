/**
 * 给 tools/ 下的冒烟脚本共用的浏览器自动化小工具（不依赖 Playwright）。
 *
 * 思路：用 --load-extension 启动一个带临时用户目录的 Edge/Chrome，
 *      通过 DevTools 协议（CDP over WebSocket）打开扩展页面、执行断言。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function findBrowser() {
  const hit = CANDIDATES.find((p) => existsSync(p));
  if (!hit) {
    console.error('找不到 Edge / Chrome，可用 EDGE_PATH=... 指定可执行文件路径。');
    process.exit(2);
  }
  return hit;
}

export async function fetchJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

export async function waitFor(fn, { timeout = 25000, interval = 250, what = '条件' } = {}) {
  const started = Date.now();
  let lastErr;
  while (Date.now() - started < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      lastErr = err;
    }
    await sleep(interval);
  }
  throw new Error(
    `等待超时（${Math.round((Date.now() - started) / 1000)}s）：${what}${lastErr ? ` — ${lastErr.message}` : ''}`,
  );
}

/** 极简 CDP 客户端：够用就好（send / on / eval / close） */
export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
        return;
      }
      const cbs = this.listeners.get(msg.method);
      if (cbs) for (const cb of cbs) cb(msg.params);
    });
  }

  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error(`CDP 连接失败：${url}`)), { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, 30000);
    });
  }

  on(method, cb) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(cb);
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || '页面脚本抛错');
    }
    return r.result?.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

/**
 * 启动浏览器并加载扩展。
 * @returns {{proc, port, profileDir, url, kill:()=>void}}
 */
export async function launchBrowser({ extDir, headless = true, extraArgs = [] }) {
  const browserPath = findBrowser();
  const profileDir = mkdtempSync(join(tmpdir(), 'bvc-smoke-'));
  const port = 9333 + Math.floor(Math.random() * 300);
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-gpu',
    ...extraArgs,
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new');

  const proc = spawn(browserPath, args, { stdio: 'ignore', windowsHide: true });
  const kill = () => {
    try {
      proc.kill();
    } catch {}
    setTimeout(() => {
      try {
        rmSync(profileDir, { recursive: true, force: true });
      } catch {}
    }, 500);
  };

  await waitFor(
    async () => {
      const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      return version.Browser;
    },
    { what: '浏览器启动并开放调试端口' },
  );

  return { proc, port, profileDir, url: `http://127.0.0.1:${port}`, kill, browserPath };
}

/**
 * 找出「我们的」扩展 id。
 * 注意：Edge 会顺带加载一堆内置扩展，所以不能拿第一个 chrome-extension:// 目标，
 * 而是认它的 service worker = src/background.js；再退回读 Preferences 里的 path。
 */
export async function waitExtensionId(port) {
  return waitFor(
    async () => {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const hit = targets.find((t) => (t.url || '').endsWith('/src/background.js'));
      return hit ? new URL(hit.url).host : '';
    },
    { what: '扩展被加载（拿扩展 id）' },
  );
}

/** 读某个 profile 的 Preferences，按扩展目录反查 id（waitExtensionId 的兜底） */
export function extensionIdFromPrefs(profileDir, extDir) {
  try {
    const data = JSON.parse(readFileSync(join(profileDir, 'Default', 'Preferences'), 'utf8'));
    const settings = data?.extensions?.settings || {};
    for (const [id, value] of Object.entries(settings)) {
      if (String(value?.path || '').toLowerCase() === extDir.toLowerCase()) return id;
    }
  } catch {}
  return '';
}

/** 新开一个标签页并连上它 */
export async function openTab(port, url) {
  // 注意：/json/new?<url> 后面的查询串本身就是网址，不能再 encodeURIComponent 一次
  const target = await fetchJson(`http://127.0.0.1:${port}/json/new?${url}`, { method: 'PUT' });
  const cdp = await Cdp.open(target.webSocketDebuggerUrl);
  return { target, cdp };
}

/** 打开扩展的设置页，连上 CDP，并开始收集页面错误 */
export async function openOptionsPage(port, extId) {
  const pageUrl = `chrome-extension://${extId}/src/options.html`;
  const { target, cdp } = await openTab(port, pageUrl);
  const errors = [];
  cdp.on('Runtime.exceptionThrown', (p) => {
    errors.push(`未捕获异常：${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`);
  });
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') errors.push(`console.error：${(p.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`);
  });
  cdp.on('Log.entryAdded', (p) => {
    if (p.entry?.level === 'error') errors.push(`日志错误：${p.entry.text}`);
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  return { cdp, pageUrl, target, errors };
}
