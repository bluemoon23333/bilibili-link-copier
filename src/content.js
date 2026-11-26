/**
 * B 站视频页右下角的「复制链接」浮动按钮。
 *
 * 行为跟工具栏图标完全一致：
 * - 单击 → 第 1 条；
 * - 450 ms 内再点一下（双击）→ 第 2 条；
 * - 右键 → 页面里弹出第 3 条起的线路菜单，末尾是「线路测速 / 设置」。
 *
 * 其它原则：
 * - 只在视频页 / 番剧页 / 直播间出现，其它页面不打扰；
 * - B 站是单页应用，站内跳转不会重新加载脚本，所以轮询 URL 而不是只跑一次；
 * - 复制结果由 background 返回，按结果给出「已复制 / 复制失败」的小提示。
 */
(() => {
  if (window.__biliCopyFloatLoaded) return;
  window.__biliCopyFloatLoaded = true;

  const BUTTON_ID = 'bili-copy-float';
  const TOAST_ID = 'bili-copy-float-toast';
  const MENU_ID = 'bili-copy-float-menu';
  const VIDEO_PAGE = /^\/(video\/|bangumi\/play\/|festival\/|list\/)/;
  const BV_PATTERN = /BV[0-9A-Za-z]{10}/;
  const LIVE_HOST = /^live\.bilibili\.com$/i;
  const LIVE_ROOM = /^\/(?:[a-z]+\/)?\d{3,}(?:\/|$)/i;
  /** 和 background.js 的 DOUBLE_CLICK_WINDOW_MS 保持一致。 */
  const DOUBLE_CLICK_WINDOW_MS = 450;

  let toastTimer = 0;
  let lastClickAt = 0;

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

  /** 给后台发一条消息；回调里统一处理「复制成功 / 失败」。 */
  function send(message, okText) {
    const button = document.getElementById(BUTTON_ID);
    if (button) button.classList.add('busy');
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (button) button.classList.remove('busy');
        const error = chrome.runtime.lastError;
        if (error || !response || response.ok === false) {
          toast((response && response.reason) || '复制失败，点扩展图标试试', 'error');
          return;
        }
        if (okText) toast(okText, 'ok');
      });
    } catch {
      if (button) button.classList.remove('busy');
    }
  }

  function closeMenu() {
    const menu = document.getElementById(MENU_ID);
    if (menu) menu.remove();
  }

  function menuItem(label, onClick, extraClass) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = extraClass ? `bcf-menu-item ${extraClass}` : 'bcf-menu-item';
    item.textContent = label;
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      onClick();
    });
    return item;
  }

  function positionMenu(menu, button) {
    const rect = button.getBoundingClientRect();
    const gap = 8;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = Math.max(gap, Math.min(rect.right - width, window.innerWidth - width - gap));
    const top = Math.max(gap, rect.top - height - gap);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function openMenu(button) {
    closeMenu();
    chrome.runtime.sendMessage({ action: 'menu' }, (response) => {
      if (chrome.runtime.lastError) return;
      const items = (response && response.items) || [];
      const menu = document.createElement('div');
      menu.id = MENU_ID;
      menu.setAttribute('role', 'menu');

      for (const item of items) {
        menu.appendChild(
          menuItem(item.title, () => send({ action: 'copy-index', index: item.index }, '已复制')),
        );
      }
      if (items.length) {
        const separator = document.createElement('div');
        separator.className = 'bcf-menu-sep';
        menu.appendChild(separator);
      }
      menu.appendChild(
        menuItem('线路测速…', () => send({ action: 'open-options', anchor: 'speed' })),
      );
      menu.appendChild(
        menuItem('设置前缀与备注…', () => send({ action: 'open-options', anchor: '' })),
      );

      document.documentElement.appendChild(menu);
      positionMenu(menu, button);
    });
  }

  function createButton() {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.title =
      '单击复制第 1 条 · 双击复制第 2 条 · 右键更多线路（和工具栏图标一样）';
    button.innerHTML = '<span class="bcf-icon">▶</span><span class="bcf-text">复制链接</span>';

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      const isDoubleClick = now - lastClickAt <= DOUBLE_CLICK_WINDOW_MS;
      // 判成双击后清零，避免连点三下被当成两次双击。
      lastClickAt = isDoubleClick ? 0 : now;
      if (isDoubleClick) send({ action: 'copy-second' }, '已复制 · 第 2 条');
      else send({ action: 'copy-first' }, '已复制 · 第 1 条');
    });

    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openMenu(button);
    });

    return button;
  }

  function ensure() {
    const existing = document.getElementById(BUTTON_ID);
    if (!isVideoPage()) {
      if (existing) existing.remove();
      closeMenu();
      return;
    }
    if (existing) return;
    document.documentElement.appendChild(createButton());
  }

  // 点别处 / 按 Esc / 滚动时收起页面内菜单（capture 阶段，尽量抢在 B 站自己的处理器前面）。
  document.addEventListener(
    'click',
    (event) => {
      const menu = document.getElementById(MENU_ID);
      if (!menu) return;
      if (menu.contains(event.target)) return;
      if (event.target && event.target.id === BUTTON_ID) return;
      closeMenu();
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') closeMenu();
    },
    true,
  );

  ensure();
  // B 站站内跳转改的是 history，不会重新执行这个脚本，所以定期对一下 URL。
  setInterval(ensure, 1200);
  window.addEventListener('popstate', ensure);
  window.addEventListener('hashchange', ensure);
})();
