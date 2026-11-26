/**
 * B 站视频页右下角的「复制链接」浮动按钮。
 *
 * 设计原则：
 * - 只在视频页 / 番剧页出现，其它页面（首页、搜索、动态、直播列表）不打扰；
 * - 点一下等同于点一下扩展图标（走第 1 条线路），不额外引入一套逻辑；
 * - B 站是单页应用，站内跳转不会重新加载脚本，所以这里轮询 URL 而不是只跑一次；
 * - 复制结果由 background 返回，按结果给出「已复制 / 复制失败」的小提示。
 */
(() => {
  if (window.__biliCopyFloatLoaded) return;
  window.__biliCopyFloatLoaded = true;

  const BUTTON_ID = 'bili-copy-float';
  const TOAST_ID = 'bili-copy-float-toast';
  const VIDEO_PAGE = /^\/(video\/|bangumi\/play\/|festival\/|list\/)/;
  const BV_PATTERN = /BV[0-9A-Za-z]{10}/;
  const LIVE_HOST = /^live\.bilibili\.com$/i;
  const LIVE_ROOM = /^\/(?:[a-z]+\/)?\d{3,}(?:\/|$)/i;

  let busy = false;
  let toastTimer = 0;

  function isVideoPage() {
    // 直播间：背景脚本会把链接收敛成 https://live.bilibili.com/<房间号>。
    if (LIVE_HOST.test(location.hostname) && LIVE_ROOM.test(location.pathname)) return true;
    if (!VIDEO_PAGE.test(location.pathname)) return false;
    if (BV_PATTERN.test(location.href)) return true;
    // 番剧 / 课程这类没有 BV 号的页面也给按钮，背景脚本会退回「裸链接」。
    return /^\/bangumi\/play\/(ep|ss)\d+/.test(location.pathname);
  }

  function toast(text, tone) {
    let node = document.getElementById(TOAST_ID);
    if (!node) {
      node = document.createElement('div');
      node.id = TOAST_ID;
      document.documentElement.appendChild(node);
    }
    node.textContent = text;
    node.dataset.tone = tone || 'ok';
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => node.classList.remove('show'), 1800);
  }

  function createButton() {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.title = '复制这条视频 / 直播的分享链接（等同于点一下扩展图标）';
    button.innerHTML = '<span class="bcf-icon">▶</span><span class="bcf-text">复制链接</span>';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      busy = true;
      button.classList.add('busy');
      try {
        chrome.runtime.sendMessage({ action: 'copy-first' }, (response) => {
          busy = false;
          button.classList.remove('busy');
          const message = chrome.runtime.lastError;
          if (message || !response || response.ok === false) {
            toast(response && response.reason ? response.reason : '复制失败，点扩展图标试试', 'error');
            return;
          }
          toast('已复制', 'ok');
        });
      } catch {
        busy = false;
        button.classList.remove('busy');
      }
    });
    return button;
  }

  function ensure() {
    const existing = document.getElementById(BUTTON_ID);
    if (!isVideoPage()) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    document.documentElement.appendChild(createButton());
  }

  ensure();
  // B 站站内跳转改的是 history，不会重新执行这个脚本，所以定期对一下 URL。
  setInterval(ensure, 1200);
  window.addEventListener('popstate', ensure);
  window.addEventListener('hashchange', ensure);
})();
