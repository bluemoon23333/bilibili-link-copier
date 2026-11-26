/**
 * 离屏文档：MV3 的 Service Worker 没有 DOM，无法直接写剪贴板，
 * 因此用一个不可见的离屏文档执行 document.execCommand('copy')。
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'copy-to-clipboard') return false;
  sendResponse({ ok: writeToClipboard(String(message.text || '')) });
  return false;
});

function writeToClipboard(text) {
  if (!text) return false;

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'readonly');
  area.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none;';
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, area.value.length);

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }

  area.remove();
  return ok;
}
