/**
 * 截一张「B 站视频页右下角复制按钮」的图，存到 docs/button.png。
 * 运行：node tools/shot-content.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { launchBrowser, openTab, sleep, waitFor } from './lib/browser.mjs';

const EXT_DIR = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(EXT_DIR, 'docs', 'button.png');
const URL_VIDEO = process.env.SMOKE_VIDEO || 'https://www.bilibili.com/video/BV1AM4y1M71p';

const browser = await launchBrowser({
  extDir: EXT_DIR,
  headless: true,
  extraArgs: ['--window-size=1280,820'],
});
try {
  const { cdp } = await openTab(browser.port, URL_VIDEO);
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 820,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor(() => cdp.eval(`Boolean(document.getElementById('bili-copy-float'))`), {
    timeout: 25000,
    interval: 300,
    what: '浮动按钮出现',
  });
  await sleep(2500);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log(`截图已保存：${OUT}`);
} finally {
  browser.kill();
}
