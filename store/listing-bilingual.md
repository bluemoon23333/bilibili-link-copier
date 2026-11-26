# Edge 加载项商店：中英文双语填写文案（1.4.4）

对应「属性」页每个语言点「编辑详细信息」后要填的内容。字符数已按商店上限核对：
名称 ≤ 45、简短描述 ≤ 132、详细描述 ≤ 10,000（且 ≥ 250）。

徽标：`store/logo-300.png`（300×300 PNG，圆角透明背景）。
截图：`store/screenshots/01-options.png`、`02-speedtest.png`、`03-button.png`（1280×800）。

---

## 中文（中国）

**扩展名**（18 字符）

```text
B站链接复制（解析线路 / BV号）
```

**简短描述**（81 字符）

```text
一键复制 B 站视频的 BV 号、解析站链接，或按测速挑出最快的 CDN 直链；多线路 + 备注、线路测速、页面浮动按钮，支持分P / 番剧 / 列表 / 直播。
```

**详细描述**（约 900 字符）

```text
把 B 站视频链接变成「现在就能播的链接」，一次点击。

【怎么用】
· 单击工具栏图标 → 用第 1 条线路
· 双击图标（450ms 内）→ 用第 2 条线路
· 右键图标 → 第 3 条起的线路，外加「线路测速…」「设置前缀与备注…」
· B 站视频页右下角还有浮动「复制链接」按钮，效果等同点一下图标

【线路 = 前缀 + 接什么】
每条线路由「前缀」和「后面接什么」组成，后半段可以是有效链接或 BV 号。所以可以复制：
· 裸 BV 号（前缀留空）
· B 站短链 b23.tv
· 你惯用的第三方解析站链接，例如 https://api.xuan25.com/bili-resolve/BV1xxxx
最多 20 条，每条都能写备注，备注就是右键菜单里显示的名字；支持上下调整、删除、恢复默认。

【线路测速】
点「开始测速」，用你指定的测试 BV 号跑一遍：连通性 → 解析站 302 延迟 → 解析出来的每个 CDN 节点（含出现概率）→ CDN 延迟与下载速率。
结果用图标标好坏、自动保存，下次打开还能看到上一次的数据。只读视频开头几 MB，十几秒就能跑完，不会把整段视频拉下来。

【智能最快】
按上一次测速的排行榜，自动解析并挑出当前最快、又连得上的 CDN 直链：
同族 *.bilivideo.com 节点直接换 host（签名可复用，省掉反复解析）；跨族的节点则找「上次真的吐出过它」的解析站，限定尝试次数，失败自动退第二快。

【支持的链接】
BV 号页、av 号页、b23.tv 短链、番剧 ep、分 P（自动带 ?p=）、收藏夹 / 列表页、直播间——自动识别出可复制的那个 BV 号 / ep 号 / 房间号。

【隐私】
不收集、不上传、不出售任何个人数据；没有服务器，也没有统计。配置存在浏览器本地（sync 存储可跨设备同步），测速结果只留在本机。

【已知限制】
· B 站匿名接口最高 720P，所以解析站给出的直链基本是 720P（1080P 需要登录 Cookie，本扩展不做）
· CDN 直链有时效，跨设备或过一段时间可能失效；想把链接发给朋友，优先用解析站链接
· 直播与部分番剧依赖解析站是否支持

开源地址：https://github.com/bluemoon23333/bilibili-link-copier
```

**搜索词**

```text
bilibili, BV号, 复制链接, 解析站, VRChat, CDN, 测速
```

**类别**：生产力（Productivity）。若商店里更偏好娱乐向，可换成「娱乐」。

---

## English

**Name** (20 chars)

```text
Bilibili Link Copier
```

**Short description** (127 chars)

```text
Copy a Bilibili video's BV id, resolver link, or fastest CDN URL. Multi-line with notes, speed test, context menu, page button.
```

**Detailed description**

```text
Turn a Bilibili video page into a link that plays right away — in one click.

HOW IT WORKS
· Click the toolbar icon → line 1
· Double-click the icon (within 450 ms) → line 2
· Right-click the icon → line 3 and below, plus "Line speed test…" and "Edit prefixes & notes…"
· A floating "复制链接" (copy link) button also appears at the bottom-right of Bilibili video pages; it does exactly the same as clicking the icon.

LINES = PREFIX + WHAT COMES NEXT
Every line is a prefix plus either a valid link or a BV id, so you can copy:
· a bare BV id (leave the prefix empty)
· a b23.tv short link
· your favourite third-party resolver link, e.g. https://api.xuan25.com/bili-resolve/BV1xxxx
Up to 20 lines, each with a note; the note becomes the context-menu title. Reorder, delete or restore defaults at any time.

LINE SPEED TEST
Press "Start test" and the extension walks every line with a test BV id: reachability → resolver 302 latency → each CDN node it returns (with how often it appears) → CDN latency and download speed.
Results are graded with icons, saved automatically, and shown again next time. It only reads the first few MB of the video, so a full run takes roughly 10–20 seconds.

SMART FASTEST
Using the last test ranking, it resolves the video and picks the fastest CDN that is actually reachable:
same-family *.bilivideo.com nodes are switched by host only (the signature is reusable, so there is no need to resolve again); other families are fetched from a resolver that previously returned that node, with a hard attempt limit and automatic fallback to the next-fastest node.

SUPPORTED LINKS
BV pages, av pages, b23.tv short links, bangumi episodes, multi-part videos (adds ?p=), favourites / lists and live rooms — the copyable BV id / episode id / room id is detected automatically.

PRIVACY
No personal data is collected, uploaded or sold. No servers, no analytics. Settings live in your browser profile (sync storage may sync across your devices); speed-test results stay on this machine.

KNOWN LIMITS
· Bilibili's anonymous API tops out at 720p, so resolver links are usually 720p (1080p needs a logged-in cookie; this extension does not do that).
· CDN direct links expire. To share with friends, use a resolver link.
· Live streams and some bangumi episodes depend on the resolver.

Source: https://github.com/bluemoon23333/bilibili-link-copier
```

**Search terms**

```text
bilibili, BV id, copy link, resolver, VRChat, CDN, speed test
```

**Category**: Productivity (use Entertainment if you prefer a media-oriented listing).
