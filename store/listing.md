# Edge 插件商店上架材料

本目录是给 **Microsoft Edge Add-ons**（Partner Center）用的上架素材与填写文案，不参与扩展运行，也不会被打进 `dist/*.zip`。

- 扩展包：`node tools/pack.mjs` → `dist/bilibili-bv-copier-<version>.zip`（根目录含 `manifest.json` / `_locales` / `src` / `icons`）
- 商店图标：`store/icon-300.png`（300×300，1:1）
- 截图：`store/screenshots/`（1280×800，PNG）
  - `01-options.png` 线路列表与备注
  - `02-speedtest.png` 线路测速（解析延迟 + CDN 节点 + 速率）
  - `03-button.png` B 站视频页右下角的复制按钮
- 隐私政策：`PRIVACY.md`（Markdown 原文）+ `store/privacy-policy.html`（可直接托管的网页版，含中英双语）

---

## 1. 基本信息

| 字段 | 建议填写 | 说明 |
|---|---|---|
| 扩展名称 | `B站链接复制（解析线路 / BV号）` | manifest 里是 `__MSG_extName__`，中文环境显示这个；≤45 字符 |
| 简短描述 | `一键复制 B 站视频的 BV 号、解析站链接或最快 CDN 直链；支持多线路、右键菜单、线路测速和页面浮动按钮。` | 对应 manifest `description`，≤132 字符 |
| 分类 | `Fun` / `Productivity`（建议 Productivity → 社交工具相关） | 按 Partner Center 下拉选择 |
| 语言 | 中文（简体）+ English（可选） | 包内已带 `_locales/zh_CN` 与 `_locales/en` |
| 隐私政策 URL | 把 `store/privacy-policy.html` 放到可公开访问的 **HTTPS** 地址，填该 URL（托管办法见下面「§5」） | 扩展会向第三方解析站发请求，商店要求提供 |
| 支持邮箱 | `bluemoon23333@163.com` | 审核与用户联系用 |
| 官网（可选） | 仓库地址或说明页 | 可留空 |

> manifest 的 `default_locale` 已设为 `zh_CN`，Edge 上传页要求的「指定默认语言等详细信息的清单文件」即指此。

## 2. 详细描述（可直接粘贴，≥250 字符）

```
在 B 站看视频时，经常需要把链接发给别人、或者贴到 VRChat 等播放器里。这个扩展把这件事变成一次点击。

【三种复制方式】
· 单击工具栏图标：复制第 1 条线路（默认「后海线路」）
· 双击工具栏图标：复制第 2 条线路（默认就是裸 BV 号）
· 右键工具栏图标：第 3 条起的线路都在菜单里，备注会直接显示成菜单项

【线路可以自己配】
每条线路 = 前缀 + 接什么。接「有效链接」就得到 https://www.bilibili.com/video/BV... 这样的页面地址；接「BV 号」就得到 https://api.xuan25.com/bili-resolve/BV... 这样的解析地址。前缀留空就只复制 BV 号，所以「复制 BV 号」不需要单独的功能。最多 20 条，每条都能写备注、调整顺序。

【线路测速】
点「开始测速」，用一个测试 BV 号把每条线路跑一遍：能不能连通、解析站回 302 要多久、解析出来哪些 CDN 节点（含出现概率）、每个节点的首包延迟和下载速率，并用图标标出好坏。结果自动保存，下次打开还能对照。测速只读视频开头几 MB、每个节点最多 2 秒，十几秒就能跑完，不会给 B 站和解析站造成压力。

【智能最快】
第 3 条默认是「智能最快」：点一下会根据上次测速的结果，自动挑出最快的那条 CDN 直链（同族节点直接换签名 host，省掉反复解析），拿到手就能直接播。注意：直链只代表你本机下载快，好友那边不一定快，和房间里的人一起看请优先用解析站链接。

【还有】
· B 站视频页右下角有浮动「复制链接」按钮，等同点一下图标，不用切到工具栏
· 支持普通视频、分 P、番剧、列表页、直播间，自动识别 BV 号 / ep 号 / 房间号
· 改配置自动保存；内置「恢复默认」；不需要任何账号

说明：解析与播放依赖第三方解析站和 B 站 CDN，它们偶尔会限流或不可用，这属于对方服务状态，不影响复制 BV 号这类本地功能。扩展不收集任何个人数据，详见隐私政策。
```

## 3. 权限用途说明（Partner Center 会逐项问）

| 权限 | 填写说明 |
|---|---|
| `activeTab` | 只有你点图标 / 双击 / 右键菜单时，才读取当前标签页的 URL 与页面里的 BV 号，用来拼出要复制的链接。 |
| `scripting` | 同上，读取页面里的 BV 号与分 P 号；并用注入的 textarea 作为剪贴板写入的兜底方案。 |
| `offscreen` | MV3 的 service worker 不能直接写剪贴板，用离屏文档完成复制。 |
| `clipboardWrite` | 把生成的链接写入剪贴板。 |
| `storage` | 保存你配置的线路、备注与上次测速结果。 |
| `contextMenus` | 生成右键菜单里的线路项。 |
| `host_permissions`（bilibili.com / bilivideo.com / bilivideo.cn / akamaized.net / 五个默认解析站 / api.squidtail.com） | 直接向你配置的解析站与 B 站 CDN 发起解析与测速请求，避免每次弹跨域授权。默认线路就是这些站点。 |
| `optional_host_permissions: <all_urls>` | 只有你点击「开始测速」且配置里含其他站点时才申请；拒绝不影响复制功能。 |

## 4. 上架前检查

- [x] `manifest.json` 含 `name` / `version` / `description` / `permissions` / `default_locale`
- [x] `_locales/zh_CN/messages.json`、`_locales/en/messages.json`
- [x] 图标 16/32/48/128 + 商店 300×300
- [x] 3 张 1280×800 截图
- [x] `PRIVACY.md` + `store/privacy-policy.html`（网页版隐私说明，可直接托管）
- [x] 支持邮箱已填 `bluemoon23333@163.com`
- [ ] 用 `node tools/pack.mjs` 重新打包，确认 zip 根目录直接是 `manifest.json`（不要多套一层文件夹）
- [ ] 在 Partner Center 上传 zip → 填写上面的文案 → 提交审核

## 5. 隐私政策怎么放上网（三选一）

审核方会真的打开这个 URL，所以必须是**公开、可直接访问、不需要登录**的 HTTPS 地址。

| 办法 | 步骤 | 得到的 URL 形如 |
|---|---|---|
| **GitHub Pages**（推荐，免费、稳定） | 新建公开仓库 → 把 `store/privacy-policy.html` 上传并改名为 `index.html`（或在根目录 `index.html` 里放它）→ 仓库 Settings → Pages → Source 选 `main` / root → 等 1 分钟后访问 | `https://<用户名>.github.io/<仓库名>/` |
| **Gitee Pages** | 同上，国内访问更快；需要仓库公开并开通 Pages 服务 | `https://<用户名>.gitee.io/<仓库名>/` |
| **任意静态托管 / 自己的服务器** | 把 `privacy-policy.html` 传到站点根目录或子目录，开启 HTTPS | `https://你的域名/privacy.html` |

放好之后，用浏览器**无痕窗口**打开一次，确认不用登录也能看，再把地址填进商店的「隐私政策 URL」。

## 6. 发布到 Chrome 网上应用店（可选）

同一份 zip 可以直接上传 Chrome Web Store（`manifest_version: 3`，`minimum_chrome_version: 109`）。差别只有：Chrome 要求 `description` ≤132 字符（已满足）、截图 1280×800 或 640×480（已满足）、单次上传包 ≤2 GB（远小于）。
