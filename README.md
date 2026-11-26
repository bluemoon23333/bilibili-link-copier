# B站链接复制（浏览器扩展）

> 仓库：<https://github.com/bluemoon23333/bilibili-link-copier> · 主页：<https://bluemoon23333.github.io/bilibili-link-copier/> · 隐私政策：<https://bluemoon23333.github.io/bilibili-link-copier/privacy.html>
> 下载安装：<https://github.com/bluemoon23333/bilibili-link-copier/releases/latest>（zip 解压后 `edge://extensions` → 开发人员模式 → 加载解压缩的扩展）


把 B 站视频页一键变成「现在就能播的链接」：复制 BV 号、复制裸链接，或者套上你惯用的解析站前缀。

- 配置是一个**有序列表**，每条 = **前缀字符串** + **后面接什么**（接有效链接 / 接 BV 号）+ **备注**。
- **单击图标** → 用**第 1 条**配置
- **双击图标**（450ms 内两次）→ 用**第 2 条**配置
- **右键图标** → 菜单里逐条列出**第 3 条起**的配置，外加「线路测速…」「设置前缀与备注…」
- 默认第 3 条是**「智能最快」**：点一下自动从上次测速的排行榜里挑最快、且当前能连通的那个 CDN，直接给你**视频直链**（不是解析站链接）
- B 站视频页右下角还有一个**「复制链接」浮动按钮**，点它等同于点一下扩展图标

> 从 1.4.0 起，右键菜单里**不再有固定的「复制 BV 号」项**：把某条配置的前缀留空、类型选「接 BV 号」，效果完全一样（而且可以给它起备注、放到任意位置）。

举例（默认配置就是后面这套「七条线路」）：

| 配置 | 用途 | 复制内容示例 |
| --- | --- | --- |
| `https://api.xuan25.com/bili-resolve/` + 接 BV 号 | 单击 | `https://api.xuan25.com/bili-resolve/BV1unhJ6JEvE` |
| （空） + 接 BV 号 | 双击 | `BV1unhJ6JEvE` |
| 智能最快节点 | 右键菜单第 1 项 | `https://upos-sz-estgcos.bilivideo.com/upgcxcode/…mp4?…`（按测速排名挑的最快 CDN 直链） |
| `http://ckapi.sevenbrothers.cn/bili/api?id=` + 接 BV 号 | 右键菜单第 2 项 | `http://ckapi.sevenbrothers.cn/bili/api?id=BV1unhJ6JEvE` |

## 一、安装（Chrome / Edge，开发者模式加载）

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 打开右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本文件夹（含 `manifest.json` 的那一层）。
4. 建议固定到工具栏：点击拼图图标 → 固定本扩展。

也可以先解压 `dist/bilibili-bv-copier-1.4.1.zip`，再执行第 3 步选择解压后的目录。

要求 Chromium 内核 ≥ 109（Chrome 109 / Edge 109 及以上）。

## 二、使用

| 操作 | 结果 | 工具栏角标 |
| --- | --- | --- |
| 单击图标 | 复制第 1 条配置 | `URL+`（紫）／空前缀时是 `BV` 或 `URL` |
| 双击图标（450ms 内两次点击） | 复制第 2 条配置 | 同上 |
| 右键图标 → `3. 纯K线路 · ckapi…` | 复制第 3 条起对应的配置 | `URL+` |
| B 站视频页右下角「复制链接」按钮 | 同工具栏图标：单击第 1 条 / 双击第 2 条 / 右键展开菜单 | 页面上弹「已复制 · 第 N 条」 |
| 右键图标 → 线路测速… | 打开设置页并滚动到测速面板 | — |
| 右键图标 → 设置前缀与备注… | 打开设置页 | — |
| 非 B 站页面 / 取不到所需内容 | 不复制任何内容 | `!`（红） |

角标 1.8 秒后自动消失。复制成功后直接 Ctrl+V。

工具栏图标的悬停提示会实时显示「单击：后海线路　双击：复制BV号　右键：更多线路 / 测速」，不用打开设置页也能想起哪条是哪条。

### 页面上的「复制链接」按钮

打开任意 B 站视频页（`/video/BV…`）、番剧页（`/bangumi/play/ep…`）、列表页（`/list/…`）或直播间（`live.bilibili.com/12345`），右下角（距右 20px、距底 30px，页面滚动时一直贴着屏幕角）会出现一个粉色「▶ 复制链接」胶囊按钮。

- 行为跟工具栏图标完全一样：
  - **单击** → 第 1 条线路；
  - **450 ms 内点两下（双击）** → 第 2 条线路；
  - **右键** → 按钮上方弹出一个小菜单，列出第 3 条起的线路（名字和工具栏右键菜单一致），末尾是「线路测速…」「设置前缀与备注…」。
- 结果直接弹在按钮上：「已复制 · 第 1 条」/「已复制 · 第 2 条」/「已复制」/失败原因。
- 点空白处或按 Esc 收起菜单（按钮是固定在屏幕上的，滚动页面不会把菜单甩走）。
- B 站是单页应用，站内跳转不重新加载页面，所以脚本每 1.2 秒对一次 URL，进出视频页时按钮会自己出现/消失。
- 只在上述页面出现，首页 / 搜索 / 动态页不会打扰你。
- 不想用可以不管它：它不拦截任何点击，`z-index` 也压不过播放器控件。

### 支持哪些链接

| 页面 | 取出什么 | 复制成什么 |
| --- | --- | --- |
| `www.bilibili.com/video/BV…` | BV 号 + `?p=` | 按条目类型拼（前缀 + BV / 最短链接） |
| `www.bilibili.com/video/av…` | 原始链接 | 最短链接（`/video/av…`） |
| `www.bilibili.com/bangumi/play/ep…` | `ep_id` | `https://www.bilibili.com/bangumi/play/ep…` |
| `www.bilibili.com/list/…?bvid=BV…` | 查询参数里的 BV | 收敛成 `https://www.bilibili.com/video/BV…?p=N` |
| `live.bilibili.com/12345`（或 `/blanc/12345`） | 房间号 | `https://live.bilibili.com/12345` |
| `b23.tv/xxxx` | 原样 | 原短链（要先自己点开跳转才能拿到 BV） |

### 设置页

打开方式：右键图标 → 「设置前缀与备注…」；或在扩展管理页点「扩展程序选项」。

每一行从左到右：

1. **序号**
2. **类型下拉**：`接有效链接` / `接 BV 号` / `智能最快节点` / `解析接口（JSON）`
3. **前缀字符串**输入框
4. **备注**输入框（最多 24 字）—— 会显示在右键菜单里、工具栏提示里、测速结果里
5. **用途标签**：`单击`（第 1 条）/ `双击`（第 2 条）/ `菜单`（第 3 条起）
6. `↑` `↓` `删除`

底部「＋ 添加一条」最多 20 条；所有改动**自动保存**，下面的「效果预览」实时显示单击 / 双击 / 右键菜单分别会复制出什么。

前缀规则：

- **原样拼接**，不做 URL 转义，也不会自动去空格。
- `接有效链接`：前缀后接最短有效链接；`接 BV 号`：前缀后接 BV 号。
- **留空**：只复制后半段（空前缀 + 接 BV 号 = 裸 BV 号）。空着的那行输入框里会显示「输入解析站前缀链接，空着为复制BV号」提醒。
- **占位符**：前缀里写 `{url}` / `{bv}` 可把内容插到中间，例如 `bv={bv}&url={url}`。

配置存在 `chrome.storage.sync`（同账号自动同步）。旧版本自动迁移：1.1.0 的单条字符串、1.2.0 的字符串数组、1.3.0 的单条默认配置都会被转成新结构，并按前缀补上默认备注。

### 默认的七条线路（1.4.5 首次安装）

| # | 用途 | 类型 | 前缀 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | 单击 | 接 BV 号 | `https://api.xuan25.com/bili-resolve/` | 后海线路 |
| 2 | 双击 | 接 BV 号 | （空，只复制 BV 号） | 复制BV号 |
| 3 | 菜单 1 | 智能最快节点 | （不用填） | 智能最快 |
| 4 | 菜单 2 | 接 BV 号 | `http://ckapi.sevenbrothers.cn/bili/api?id=` | 纯K线路 |
| 5 | 菜单 3 | 接 BV 号 | `https://bil.ouo.chat/player/?url=` | 星流线路 |
| 6 | 菜单 4 | 接 BV 号 | `https://biliplayer.91vrchat.com/player/?url=` | 孤线路 |
| 7 | 菜单 5 | 接 BV 号 | `https://ktv.chiooone.com/player/?url=` | 暖夜线路 |

六个前缀都验证过「**直接接裸 BV 号**就能解析」：返回 302 跳到 `upos-sz-*.bilivideo.com` 的 mp4 直链。

### 「智能最快」条目是怎么工作的

它不联网乱试，而是**吃测速结果**：先看上次测速里哪些 CDN 快，再决定怎么拿到那条直链。

1. 从测速结果里按速率排出节点榜（去掉 <0.5 MB/s 的），第一名就是目标。
2. **目标节点属于 `*.bilivideo.com` 且路径是 `/upgcxcode/…`** → 这类链接的签名不绑主机名，所以随便找一条线路解析一次，把 host 换成目标节点即可（1 次解析 + 1 次 1 字节验证，通常 300~500 ms）。
3. **目标节点是别的族**（PCDN 的 `mcdn.bilivideo.cn`、Akamai 等）→ 只去问「上次测速里真的吐出过这个节点」的解析站，最多 2 条 × 2 次。
4. 第一名失败就退第二名、第三名；全都拿不到就退回「按线路顺序解析一次」的兜底，实在不行报「暂无可用的高速地址」。
5. 总预算 9 秒、最多 6 次尝试，超了就带最好的结果返回，不会让你等到天荒地老。

所以**先点一次「开始测速」，智能条目才有依据**；没测过也能用，只是它会按线路顺序解析一次，跟普通条目差不多。

> 换 host 只对同族 `*.bilivideo.com` 的 `/upgcxcode/…mp4` 有效。PCDN 的 `.m4s` 分片（`/v1/resource/`）换过去会 403，所以那类地址不换。

### 「解析接口（JSON）」条目

有些解析服务不是 302，而是回一段 JSON（比如 Bili2VRC 的 `https://api.squidtail.com/bili2vrc/parse/`：`?bv=&p=&format=mp4&otype=json` → `{code,quality,url}`）。这种不能当普通前缀用，所以单独给了个类型：

- 填**接口地址**（可以已经带参数，缺的 `bv` / `p` / `format=mp4` / `otype=json` 会自动补上）；
- 点条目时扩展自己 fetch 这个接口，读出 JSON 里的 `url` 字段再复制；
- 角标显示 `API`。

注意：这类接口返回的也是 **720P**（原因见「已知限制」），而且依赖第三方服务，挂了就复制失败。

## 三、线路测速

设置页第三块「线路测速」：选一个**测试用 BV 号**（默认 `BV1AM4y1M71p`）和一个档位，点「开始测速」。

### 测什么

对每条非空前缀的线路，依次做三件事：

1. **连通性 + 解析站 302 延迟**：`fetch(url, {redirect:'manual'})` —— 只拿状态码，**不会跟着跳到视频**，所以这一步几乎不产生视频流量。记下从发出请求到拿到响应的毫秒数。
2. **解析出的 CDN 节点**：`fetch(url, {redirect:'follow', Range: bytes=0-0})` —— 跟着 302 走到底，记下最终 URL 的主机名，拿到响应头就立刻取消。重复若干轮（快速 3 轮 / 标准 6 轮 / 深入 10 轮），因为同一个解析站**会轮换**给你不同地域的 CDN，多测几轮才能看出它到底可能给哪些节点、各占多少。每轮的落点会累计成**出现概率**（`出现 3/5 轮（60%）`）。
3. **CDN 延迟 + 下载速率**：对每个去重后的最终节点发一次 `Range: bytes=0-3145727`（最多 3 MB），读最多 2 秒，算出 `字节数 ÷ (总耗时 - 首包耗时)`。首包和速率分开记，因为「卡一下」通常是首包慢，而「播到一半卡」是速率不够。

### 怎么保证既快又不粗暴

| 措施 | 数值 | 目的 |
| --- | --- | --- |
| 线路之间并行 | 5 条同时开测 | 总耗时 = 最慢那条，而不是相加 |
| 单条线路内串行 + 间隔 | 每轮之间 600 ms | 不给同一个站连发 |
| 单条线路最多请求数 | 1（302）+ 轮次（跟随），标准档 ≤ 7 | 标准档对一个解析站最多 7 个请求 |
| **自适应早停** | 连续 4 轮落在同一个节点 → 停 | xuan25 这类不轮换的站只测 4 轮就收手 |
| 单条线路总预算 | 18 秒 | 某个站挂了也不会把整轮拖长 |
| 单次超时 | 302：5 s；跟随：8 s | 卡住就判失败，不无休止等 |
| **边解析边量 CDN** | 解析阶段一拿到节点就开始量 | CDN 测速藏在解析的尾巴后面，整体少等 3~5 秒 |
| CDN 下载并发上限 | 解析期间 2 个节点，解析完放宽到 4 个 | 单节点最多 3 MB / 2 秒 |
| 结果自动去重 | 同一节点只量一次 | 多个解析站给同一个 CDN 时不重复拉 |

一轮「标准」（6 轮）实测 **10 ~ 15 秒**（浏览器内 10.0 s / 14.4 s；Node 真机 9.8 s；5 条可测线路 + 2 个不联网条目）。最坏情况：所有站都卡死 → 18 秒（并行）+ 剩余 CDN 阶段 ≈ 20 秒，仍在可接受范围。想要把一个解析站的轮换范围彻底摸清，用「深入 · 10 轮」，约 25 ~ 35 秒。

### 怎么看结果

表头 7 列：**线路 / 连通 / 解析延迟 / 节点数 / 最快节点 / CDN 延迟 / 评级**

空前缀和「智能最快」这两类条目不联网，**表格里直接不显示**，只保留真正能测的线路（万一全是不联网的，会提示一句「没有需要测速的线路」）。

两个延迟分属不同环节，别混在一起看（表格下面也有一行同样的说明）：

| 列 | 是谁的延迟 | 决定什么 |
| --- | --- | --- |
| 解析延迟 | 解析站回 302 的时间 | 点开链接后要等多久才开始拉流 |
| CDN 延迟 | 从 CDN 拿到第一个字节的时间 | 起播快不快（首帧前的等待） |

- 连通：`✅` 正常 / `⚠️` 慢（>2 s）/ `❌` 失败 / `⏳` 进行中
- 评级：`⚡ 极佳` ≥6 MB/s、`🟢 良好` ≥3、`🟡 可用` ≥1.2、`🟠 偏慢` ≥0.5、`🔴 很慢`、`⛔ 失败`、`❔ 未知`（连上了但没量到速率）
- 每行下面展开列出**这次探测到的每一个 CDN 节点**：`主机名 — 速率 · CDN 延迟 · 出现 x/y 轮（百分比）`，节点按出现次数从多到少排；末尾再给一句「测几次、成功几次、共几个节点」。

明细里的「出现 x/y 轮」就是**这个节点在这条线路上的命中概率**——y 是成功解析的轮数，x 是落到该节点的轮数。「落到 N 个节点」则说明这个解析站的轮换范围：N 越大，你每次播放抽到快/慢节点的随机性越大。

> 概率是采样估计：标准档 6 轮，概率是 1/6 的整数倍；想更准就用深入档（10 轮）或隔一会儿再测一次。会轮换的站才测满，连续 4 轮都落在同一个节点就提前收手。

结果存在 `chrome.storage.local`：**关掉设置页、重开浏览器都还在**，重开页面自动回显上次结果并标注「已载入上次测速结果（时间）」；「查看上次结果」随时可再翻出来，随时可以重新测。

### 为什么第一次点测速会弹权限框

测速要在扩展页面里直接请求解析站和 CDN，这些域名不在扩展的默认权限范围内。扩展只声明了**可选权限** `optional_host_permissions: ["<all_urls>"]`，第一次点「开始测速」时浏览器会问一次「允许访问这些网站？」，点允许即可，之后不再问。

不想给权限也行：复制功能完全不需要它，只是测速会提示「没有『访问网站』权限就没法直接从浏览器测速」。

### 实测样例（2026-11-26，本机直连，标准档 6 轮，测试 BV `BV1AM4y1M71p`）

| 线路 | 解析延迟 | 探测到的节点（出现概率） | 最快速率 |
| --- | --- | --- | --- |
| 后海线路 xuan25 | 0.8 ~ 3.2 s（波动大） | `estgoss`（4/4 · 100%） | 7.6 MB/s |
| 纯K线路 ckapi | 0.12 ~ 0.2 s | `mirror08c` / `mirrorcos` / `mirrorali`（各 1/3） | 2.96 MB/s |
| 星流线路 ouo | 0.5 ~ 0.8 s | `cn-zjjh-ct-04-05`（3/4 · 75%）/ `-04-06`（1/4） | ≈1 MB/s |
| 孤线路 91vrchat | 1.5 ~ 2.0 s（Cloudflare） | `estgcos`（2/5 · 40%）/ `mirrorcos`（2/5）/ `mirrorcoso1`（1/5） | **26.5 MB/s** |
| 暖夜线路 chiooone | 0.7 ~ 1.1 s | `mirrorcos`（4/4 · 100%） | 2.96 MB/s |

结论很直白：**孤线路有 40% 概率抽到 `estgcos`（26 MB/s），抽不到就只有 1~3 MB/s**；后海线路则稳定给 `estgoss`。解析站本身快慢（0.1 s vs 3 s）只影响「点开那一刻要等多久」，真正决定播放流畅度的是它给的 CDN 节点。

## 四、设计说明

### 1. 单击 / 双击的判定

浏览器只提供 `chrome.action.onClicked`，每次点击触发一次事件，**没有原生 dblclick**。本扩展采用「**单击立即执行，双击时覆盖**」：

- 第一次点击马上复制第 1 条配置的结果；
- 若 450ms 内出现第二次点击，就在同一任务队列里追加一次「复制第 2 条」，覆盖刚写入的内容；
- 所有剪贴板写入走一条 Promise 任务链**串行执行**，读配置也在队列内完成，杜绝异步乱序；
- 双击判定按标签页记录，两个标签页各点一下不会被误判。

代价：第 2 条被删掉时，双击会退回「裸链接」并亮 `URL` 角标（不会什么都不做）。

页面右下角的浮动按钮复用同一套语义（内容脚本自己按 450ms 判双击），右键则由内容脚本画一个页面内菜单：先向 Service Worker 要 `menu` 数据（第 3 条起的标题 + 下标），点某一项再发 `copy-index`。这样按钮和工具栏图标的行为、菜单文案永远一致，不用在两处各维护一份配置。

### 2. 右键菜单

- 菜单在 `onInstalled` / `onStartup` / **Service Worker 冷启动**时重建，并监听 `chrome.storage.onChanged`：设置页改完立刻生效，不用重载扩展。
- 菜单 id 是 `prefix:<下标>`（下标从 0 起，只列第 3 条及以后）；点击时**重新读一次配置**，下标越界只亮红角标 `!`，绝不复制错内容。
- 条目名由 `entryMenuTitle()` 生成：`序号. 备注 · 主机名`；没填备注时退回 `序号. [BV] 去协议后的前缀`（超 40 字截断），空前缀显示 `复制裸链接` / `复制 BV 号`。

### 3. 配置结构

```js
[
  { type: 'bv',  value: 'https://api.xuan25.com/bili-resolve/', note: '后海线路' }, // 单击
  { type: 'bv',  value: '',                                     note: '复制BV号' }, // 双击
  { type: 'bv',  value: 'http://ckapi.sevenbrothers.cn/bili/api?id=', note: '纯K线路' }, // 菜单
]
```

`type` 决定后半段是「最短有效链接」还是「BV 号」，`value` 是前缀，`note` 是备注（≤24 字）。归一化时过滤非法项、未知 `type` 回退 `url`、最多 20 条、空列表回退默认值。

### 4. 测速模块（`src/lib/speedtest.js`）

纯函数 + 可注入 `fetch` / 时钟 / `AbortSignal`，因此能在 Node 里用假 fetch 跑单元测试，也能在 `tools/live-speedtest.mjs` 里用真网络跑。

对外只有一个 `runSpeedTest({ entries, bv, depth, fetchImpl, now, signal, onProgress })`，返回结构化结果（含每条线路的采样明细）。UI 只负责渲染，不参与测量逻辑。

### 5. 页面信息采集

- 点击时 `chrome.scripting.executeScript` 注入探测函数：读 `location.href`，尽力从 `window.__INITIAL_STATE__`（`bvid` / `videoData.bvid` / `epInfo.bvid` / `p` / `ep_id`）、`<link rel="canonical">`、`og:url` 取 BV 号与分 P。
- 结构化数据取不到就退回 URL 正则，失败亮 `!`，绝不乱写剪贴板。
- 复制功能只用 `activeTab` + `scripting`：仅在你点击那一刻、仅对当前标签页生效。

### 6. 剪贴板写入

MV3 的 Service Worker 没有 DOM，`navigator.clipboard` 不可用，所以：

1. 首选 `offscreen` 离屏文档（`reasons: ["CLIPBOARD"]`）+ `textarea + execCommand('copy')`，带 8 次重试（离屏文档刚建时监听器可能没好）；
2. 失败退回注入当前页面做同样的事，并保存/恢复原选区；
3. 空闲 30 秒关闭离屏文档。

### 7. 文件结构

```
manifest.json                MV3 清单（权限、图标、Service Worker、设置页、可选跨域权限、default_locale）
_locales/zh_CN/messages.json 中文名称 / 描述 / 图标提示（商店要求的默认语言）
_locales/en/messages.json    英文名称 / 描述
src/background.js            Service Worker：单击/双击、右键菜单、页面探测、复制、角标、标题
src/lib/bili.js              纯函数：BV 号提取、最短链接生成、前缀拼接
src/lib/settings.js          配置读写：{type,value,note} 列表、备注回填、旧格式迁移、测速结果存储
src/lib/speedtest.js         线路测速：解析延迟、CDN 节点轮换与出现概率、CDN 延迟与速率、评级
src/lib/auto.js              「智能最快」：按测速排名挑 CDN、同族换 host 签名、跨族回退解析
src/lib/api.js               「解析接口（JSON）」：拼参数、取 JSON 里的直链
src/content.js / content.css  B 站视频页「复制链接」浮动按钮（单击/双击/右键菜单 + SPA 路由跟随）
src/options.html/js          设置页：线路列表 + 备注 + 实时预览 + 测速面板
src/offscreen.html/js        离屏文档：剪贴板写入
icons/                       16 / 32 / 48 / 128 图标
tools/make_icons.py          图标生成脚本（纯标准库）
tools/test-bili.mjs          bili.js + settings.js 单元测试（25 例）
tools/test-click-flow.mjs    点击流仿真（假 chrome API 驱动真实 background.js）
tools/test-speedtest.mjs     测速模块单元测试（16 例，假 fetch）
tools/test-auto.mjs          「智能最快」单元测试（13 例，假 fetch）
tools/live-speedtest.mjs     真机测速（Node 里跑，无需浏览器，用来快速看线路状态）
tools/smoke-options.mjs      真实浏览器冒烟：设置页渲染 / 备注 / 预览 / 增删
tools/smoke-speedtest.mjs    真实浏览器冒烟：完整跑一轮测速，验证权限与 CORS
tools/smoke-content.mjs      真实浏览器冒烟：浮动按钮单击/双击/右键菜单 + 剪贴板内容
tools/live-auto.mjs          真机验证「智能最快」：真测速 → 真取直链 → Range 验证
tools/shot-speedtest.mjs     跑一轮测速并截图（docs/speedtest.png）
tools/shot-store.mjs         生成商店素材：store/screenshots/ 下三张 1280×800 截图
tools/lib/browser.mjs        上面几个浏览器脚本共用的 CDP 小工具
docs/speedtest.png           测速结果长什么样（实测截图）
store/listing.md             Edge 商店上架文案（名称 / 简短描述 / 详细描述 / 权限用途）
store/logo-300.png           商店徽标 300×300（与扩展图标同款）
store/listing-bilingual.md   商店中英文文案
store/screenshots/           商店截图 1280×800（设置页 / 测速 / 页面按钮）
PRIVACY.md                   隐私说明（Markdown 原文）
store/privacy-policy.html    隐私说明网页版（可直接托管，上架时填它的 URL）
```

## 五、自测

```powershell
node --test tools/test-bili.mjs        # 链接规则 + 配置结构 + 备注 + 列表/直播 25 例
node tools/test-click-flow.mjs         # 单击 / 双击 / 右键菜单 / 角标 / 标题 / 页面按钮消息
node --test tools/test-speedtest.mjs   # 测速：多轮探测、概率、去重、评级、失败原因 16 例
node --test tools/test-auto.mjs        # 智能最快：换 host、回退、预算 13 例
node tools/live-speedtest.mjs          # 真机测速（走真网络，约 10 秒）
node tools/live-auto.mjs               # 真机跑一遍「智能最快」（真测速 + 真取流）
node tools/smoke-options.mjs           # 真浏览器：设置页 26 项断言
node tools/smoke-speedtest.mjs         # 真浏览器：完整测速 17 项断言（会自动改一份临时副本）
node tools/smoke-content.mjs           # 真浏览器：B 站页浮动按钮 + 剪贴板 6 项断言
python tools/make_icons.py             # 重新生成图标
node tools/shot-store.mjs              # 重新生成商店截图（1280×800）
```

冒烟脚本会自己找 Edge / Chrome（`EDGE_PATH` / `CHROME_PATH` 可指定），用临时用户目录 + `--headless=new`，跑完自动清理，不动你日常用的浏览器配置。加 `--show` 可以看着它点。

## 六、上架 Edge 插件商店

材料都在 `store/` 里，清单与逐项要点见 [`store/listing.md`](store/listing.md)：

```powershell
node tools/pack.mjs          # → dist/bilibili-bv-copier-<version>.zip（根目录就是 manifest.json）
node tools/shot-store.mjs    # → store/screenshots/*.png（1280×800）
```

- manifest 已加 `"default_locale": "zh_CN"` 与 `_locales/zh_CN|en`，满足上传页「清单文件要含默认语言」的要求；
- 商店徽标 `store/logo-300.png`（300×300），截图 3 张 1280×800（Edge 只接受 1280×800 或 640×480）；
- 详细描述、权限用途说明可直接从 `store/listing.md` 粘贴；
- `PRIVACY.md` 是 Markdown 原文；`store/privacy-policy.html` 是可直接托管的网页版（中英双语），放到任意 HTTPS 静态空间（GitHub Pages / Gitee Pages / 自己的域名）后把地址填进商店即可，`store/listing.md` §5 有三种托管办法；
- 支持邮箱已填在 `store/listing.md` 与 `PRIVACY.md`（`bluemoon23333@163.com`）。

## 七、已知限制

- 仅在普通网页（http/https）生效；`chrome://`、扩展页面、PDF 阅读器、新标签页无法注入，角标 `!`。
- 双击窗口固定 450ms；最多 20 条配置。
- `接 BV 号` 需要当前页能取到 BV 号（B 站视频/番剧页可以；首页、动态页取不到就不复制）。
- 前缀不做 URL 转义：若目标站点要求 `?url=` 的值必须百分号编码，请自行在前缀里处理。
- 测速依赖你本机网络与解析站当时的服务状态：某些站在 Cloudflare 后面偶尔会 1~5 秒才回、甚至超时，表里会如实标 `⚠️` / `⛔`，这时重测一次通常就好。
- `http://` 前缀（如默认的 ckapi）在 https 优先的网络环境下可能被拦截；该站同时支持 https，遇到 `⛔ 失败` 可把前缀改成 `https://ckapi.sevenbrothers.cn/bili/api?id=`。
- 测速量的是「单连接」速度，不代表你播放时的多线程/多分片表现，但用来比较线路优劣足够。
- 面向 Chromium 系浏览器；Firefox 不支持 `chrome.offscreen`（会退回注入页面复制，未验证）。
- `b23.tv` 短链需要联网跳转才能展开，复制时原样保留。
- 页面结构与 `__INITIAL_STATE__` 字段由 B 站控制，改版后可能取不到结构化信息，此时退回 URL 提取，功能仍可用。
- **清晰度上限是 720P，这不是线路的问题**：五个解析站实测返回的文件全是 1280×720；匿名调 B 站 `playurl` 时 `accept_quality` 只有 `[64,16]`（720P/360P），1080P 及以上需要登录 Cookie，4K 还要大会员。换句话说「换条线路就有 1080P」不存在，除非哪天做了登录态透传。
- **直播链接只做到「复制」**：`live.bilibili.com/12345` 会被整理成标准房间号链接，但它不是视频直链；VRChat 播放 HLS 直播大概率不支持（和播放器有关）。
- **列表页**（`/list/…`）带 `bvid` 时会整理成视频链接；不带 `bvid` 的列表页只能复制页面链接本身。
- **智能最快条目依赖测速结果**：没测过会用「按线路顺序解析一次」兜底；测速时的排行榜超过 21 天会被忽略（见设置页提示），这时也走兜底。
