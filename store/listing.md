# Edge 插件商店上架材料

本目录是给 **Microsoft Edge Add-ons**（Partner Center）用的上架素材与填写文案，不参与扩展运行，也不会被打进 `dist/*.zip`。

- 扩展包：`node tools/pack.mjs` → `dist/bilibili-bv-copier-<version>.zip`（根目录含 `manifest.json` / `_locales` / `src` / `icons`）
- 商店徽标：`store/logo-300.png`（300×300，1:1，与扩展图标同款的粉色播放按钮，由 `tools/make_icons.py` 生成）
- 双语文案与徽标说明：`store/listing-bilingual.md`
- 截图：`store/screenshots/`（1280×800，PNG）
  - `01-options.png` 线路列表与备注
  - `02-speedtest.png` 线路测速（解析延迟 + CDN 节点 + 速率）
  - `03-button.png` B 站视频页右下角的复制按钮
- 隐私政策：已发布 → `https://bluemoon23333.github.io/bilibili-link-copier/privacy.html`
- 源码仓库：`https://github.com/bluemoon23333/bilibili-link-copier`（Pages 从 `main` 的 `/docs` 发布）

---

## 1. 基本信息

| 字段 | 建议填写 | 说明 |
|---|---|---|
| 扩展名称 | `B站链接复制（解析线路 / BV号）` | manifest 里是 `__MSG_extName__`，中文环境显示这个；≤45 字符 |
| 简短描述 | `点一下复制 B 站视频的 BV 号、b23 短链或你常用的解析站链接，还能测一测哪条线路最快。` | 对应 manifest `description`，≤132 字符 |
| 分类 | `Fun` / `Productivity`（建议 Productivity → 社交工具相关） | 按 Partner Center 下拉选择 |
| 语言 | 中文（简体）+ English（可选） | 包内已带 `_locales/zh_CN` 与 `_locales/en` |
| 隐私政策 URL | `https://bluemoon23333.github.io/bilibili-link-copier/privacy.html` | 已托管在 GitHub Pages，可直接填 |
| 支持邮箱 | `bluemoon23333@163.com` | 审核与用户联系用 |
| 官网（可选） | `https://github.com/bluemoon23333/bilibili-link-copier` | 已建仓库 |

> manifest 的 `default_locale` 已设为 `zh_CN`，Edge 上传页要求的「指定默认语言等详细信息的清单文件」即指此。

## 2. 详细描述（可直接粘贴，≥250 字符）

```
平时在 B 站看视频，想把链接发给朋友，或者贴到 VRChat 里放，经常要复制 BV 号、短链，或者套上某个解析站的前缀。这个扩展就是帮你少点几下。

点一下工具栏图标，复制第 1 条线路；
快速双击图标，复制第 2 条线路；
在图标上点右键，第 3 条起的线路都在菜单里，另外还有「线路测速」和设置。

线路怎么理解？
一条线路就是你填的一段链接前缀，后面接什么由你选：接 BV 号，或者接当前视频的链接。前缀什么都不填，就只复制 BV 号。

打开设置页可以：
· 添加、删除、上下移动线路
· 每条都能写个备注，备注会直接显示在右键菜单里
· 选这条线路后面接 BV 号还是接链接
· 改完自动保存，也能一键恢复默认

线路测速
设置页里有「开始测速」。填一个测试用的 BV 号，它会把每条线路挨个试一遍：连不连得上、解析要等多久、解析出来的视频地址下载快不快。结果用图标标出来，下次打开还能看到上次的结果。测速只下载视频开头的一点内容，十几秒就完事。

智能最快
默认第 3 条叫「智能最快」。点它，扩展会根据上次测速的结果，自动挑一个又快又能用的视频地址复制给你。

其他
· B 站视频页右下角有个浮动的「复制链接」按钮，点它跟点扩展图标一样
· 支持 BV 号页、av 号页、b23.tv 短链、番剧、分 P、收藏夹和列表页、直播间

隐私
不收集任何数据，没有服务器，也没有统计。配置存在浏览器里，测速结果只留在本机。

几点说明
· B 站不登录时最高只有 720P，所以解析站给的地址基本是 720P
· 视频直链会过期，想长期分享建议用解析站链接
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
- [x] 图标 16/32/48/128 + 商店徽标 300×300（`store/logo-300.png`）
- [x] 3 张 1280×800 截图
- [x] 隐私政策已上线：`https://bluemoon23333.github.io/bilibili-link-copier/privacy.html`（HTTP 200，已用无痕方式验证）
- [x] 支持邮箱已填 `bluemoon23333@163.com`
- [ ] 用 `node tools/pack.mjs` 重新打包，确认 zip 根目录直接是 `manifest.json`（不要多套一层文件夹）
- [ ] 在 Partner Center 上传 zip → 填写上面的文案 → 提交审核

## 5. 隐私政策已上线（存档说明）

当前地址：**`https://bluemoon23333.github.io/bilibili-link-copier/privacy.html`**

做法（已由脚本完成，留档备查）：

1. `docs/privacy.html` 是隐私政策网页版（中英双语），`docs/index.html` 是扩展介绍页；
2. 仓库 `https://github.com/bluemoon23333/bilibili-link-copier` 为 public，Pages 源设为 `main` 分支的 `/docs`；
3. 推送后 30~60 秒生效，`https://bluemoon23333.github.io/bilibili-link-copier/` 返回 200。

以后要改：改 `docs/privacy.html` → `git push` → Pages 自动重建。

其他托管方式（如将来想换域名）：

审核方会真的打开这个 URL，所以必须是**公开、可直接访问、不需要登录**的 HTTPS 地址。

| 办法 | 步骤 | 得到的 URL 形如 |
|---|---|---|
| **GitHub Pages**（推荐，免费、稳定） | 新建公开仓库 → 把 `store/privacy-policy.html` 上传并改名为 `index.html`（或在根目录 `index.html` 里放它）→ 仓库 Settings → Pages → Source 选 `main` / root → 等 1 分钟后访问 | `https://<用户名>.github.io/<仓库名>/` |
| **Gitee Pages** | 同上，国内访问更快；需要仓库公开并开通 Pages 服务 | `https://<用户名>.gitee.io/<仓库名>/` |
| **任意静态托管 / 自己的服务器** | 把 `privacy-policy.html` 传到站点根目录或子目录，开启 HTTPS | `https://你的域名/privacy.html` |

放好之后，用浏览器**无痕窗口**打开一次，确认不用登录也能看，再把地址填进商店的「隐私政策 URL」。

## 6. 发布到 Chrome 网上应用店（可选）

同一份 zip 可以直接上传 Chrome Web Store（`manifest_version: 3`，`minimum_chrome_version: 109`）。差别只有：Chrome 要求 `description` ≤132 字符（已满足）、截图 1280×800 或 640×480（已满足）、单次上传包 ≤2 GB（远小于）。
