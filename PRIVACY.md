# 隐私说明 / Privacy Policy

适用扩展：**B站链接复制（解析线路 / BV号）**（manifest 名 `__MSG_extName__`，默认语言 `zh_CN`）
最后更新：2026-11-26

## 一句话

这个扩展**不收集、不上传、不出售**你的任何个人数据。所有操作都在你的浏览器本地完成。

## 它读什么、为什么读

| 数据 | 什么时候 | 用途 | 是否离开本机 |
|---|---|---|---|
| 当前标签页的网址、页面标题、视频 BV 号 / 分 P 号 | 你点图标、双击图标、用右键菜单，或在视频页点浮动按钮时 | 拼出要复制的链接 | 否（只在本地拼字符串） |
| 你填写的「线路前缀」和「备注」 | 打开设置页、复制时 | 记住你的配置 | 否，存在 `chrome.storage.sync`（浏览器自带同步，由你所在的浏览器账号决定是否跨设备同步） |
| 上次测速结果（各线路延迟、CDN 节点与速率） | 打开设置页、复制「智能最快」时 | 显示上次结果、挑选最快节点 | 否，存在 `chrome.storage.local` |
| 剪贴板写入 | 复制时 | 把链接放进剪贴板 | 否 |

## 它联网做什么

只有下面两类请求，全部由你的浏览器直接发往目标网站，不经过任何第三方服务器：

1. **解析线路请求**：你点的「线路」本身就是第三方解析站（如 `api.xuan25.com`、`ckapi.sevenbrothers.cn`、`bil.ouo.chat`、`biliplayer.91vrchat.com`、`ktv.chiooone.com`）或 B 站接口。扩展把你的 BV 号拼进这些地址并发起请求，仅此而已。
2. **测速请求**：你点「开始测速」时，扩展用你填的测试 BV 号向这些线路各发若干次请求，并读取解析出来的 CDN 地址开头几 MB 数据来估算速度。这也是发往同样的第三方站点。

扩展本身**没有自有服务器**，不上报任何统计、日志或使用数据。

## 权限说明

| 权限 | 为什么需要 |
|---|---|
| `activeTab` / `scripting` | 读取当前标签页的 BV 号、分 P 号，以及在页面上写入剪贴板（兜底方案） |
| `offscreen` | 用离屏文档写剪贴板（MV3 里 service worker 不能直接写） |
| `clipboardWrite` | 把链接写进剪贴板 |
| `storage` | 保存线路配置与上次测速结果 |
| `contextMenus` | 生成右键菜单中的线路 |
| `host_permissions`（B 站 / B 站 CDN / 默认解析站） | 直接向这些站点发起解析与测速请求，不弹跨域授权框 |
| `optional_host_permissions: <all_urls>` | 只有你**主动点「开始测速」**且配置里有别的站点时才申请；拒绝也不影响复制功能 |

## 你的控制权

- 线路、备注、测试 BV 号全部由你填写，可以随时清空或恢复默认。
- 测速结果只存在本机，设置页有「恢复默认」，卸载扩展会一并删除。
- 想彻底不联网：把线路留空（只复制 BV 号），不点测速即可；扩展不会主动发任何请求。

## 第三方说明

解析站、B 站 CDN 都是第三方服务，它们各自的隐私政策与可用性由对方负责。本扩展只是把你的 BV 号拼进它们的公开接口。

## 联系方式

有问题请开 issue 或邮件联系：`bluemoon23333@163.com`

---

# Privacy Policy (English)

This extension does **not** collect, upload, or sell any personal data. Everything happens locally in your browser.

- It reads the current tab's URL/title/BV id only when you click the toolbar icon, double-click it, use the context menu, or press the in-page "复制链接" button — purely to build the string that gets copied.
- Your line prefixes, notes, and the last speed-test result are stored via `chrome.storage` (sync/local) on your own browser profile.
- Network requests go **directly** from your browser to the resolver sites you configured and to Bilibili's CDN, solely to resolve a video URL or to measure speed when you press "开始测速". There is no backend server and no telemetry.
- The optional `<all_urls>` permission is requested only when you start a speed test that needs other hosts; declining it does not affect copying.

Third-party resolver sites have their own policies and availability; this extension merely calls their public endpoints with your BV id.

Contact: `bluemoon23333@163.com`.
