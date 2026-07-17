# Changelog

All notable changes to Galley Studio are documented here.

## 0.2.6 — 2026-07-17

### 中文

- 修复“复制到公众号”仅写入纯文本、导致保存草稿或发布后样式丢失的问题；
  桌面端现在优先通过 Electron 原生剪贴板同时写入 HTML 与纯文本。
- 保留生成结果中的公众号 HTML 片段，不再在复制前进行会改变排版结构的二次重写。
- 将“复制到公众号”和“复制源码”拆分为两个明确操作，并补充复制失败原因。
- 增加公众号片段、原生剪贴板桥接及工具栏行为的回归测试。

### English

- Fix WeChat copy operations that only exposed plain text and therefore lost
  formatting after saving a draft or publishing; desktop builds now write both
  HTML and plain text through Electron's native clipboard first.
- Preserve generated WeChat HTML fragments instead of rewriting their layout
  structure immediately before copying.
- Split “Copy for WeChat” and “Copy source” into explicit actions and surface
  the underlying reason when rich-text copy fails.
- Add regression coverage for WeChat fragments, the native clipboard bridge,
  and toolbar behavior.

## 0.2.5 — 2026-07-17

### 中文

- 修复仓库相对图片路径在可视化编辑器中无法显示的问题，并在保存时保留
  HTML 原始相对路径。
- 修复本地图片在严格沙箱预览中无法加载的问题；预览阶段会读取并校验
  PNG、JPEG 与 WebP 图片，再安全地嵌入内存预览副本。
- 保持预览空沙箱、内容安全策略和移动端边界不变，单张图片读取失败时不影响
  其余文章内容与图片。
- 为 Galley Studio 宣传博客增加控制台、生成对话、文章库、主题库和可视化
  编辑器截图。

### English

- Fix vault-relative images in the visual editor while preserving their original
  relative paths when the HTML document is saved.
- Fix local images in the strict sandbox preview by validating and embedding PNG,
  JPEG, and WebP data only in the in-memory preview copy.
- Preserve the empty sandbox, content security policy, and mobile boundary while
  allowing individual image read failures to degrade without breaking the article.
- Add console, generation conversation, article library, theme library, and visual
  editor screenshots to the Galley Studio launch article.

## 0.2.4 — 2026-07-17

### 中文

- 修复 Obsidian 桌面端将 Node.js 动态导入解析为 `app://` 请求而导致的
  CORS 错误，恢复控制台、设置页和本地 CLI Agent。
- 增加仅桌面端可用的 Node 模块加载桥，并继续保持移动端预览边界。
- 增加发布回归测试，阻止原生 Node 动态导入重新进入生产包。
- 重写中英文项目介绍和 Galley Studio 宣传博客。

### English

- Fix Obsidian desktop CORS failures caused by resolving Node.js dynamic imports
  as `app://` requests, restoring the console, settings, and local CLI agents.
- Add a Desktop-only Node module bridge while preserving the mobile preview boundary.
- Add release regression coverage that rejects native Node dynamic imports in the bundle.
- Refresh the bilingual project introduction and Galley Studio launch article.

## 0.2.3 — 2026-07-16

- Remove HugeRTE's unused runtime script loader from the production bundle.
- Statically bundle every enabled HugeRTE core module, theme, icon set, and
  plugin without creating `<script>` elements.
- Add a release audit that fails if dynamic script element creation reappears
  in `main.js`.

## 0.2.2 — 2026-07-16

### 中文

- 清除 Obsidian 插件审核中的全部阻断错误，包括不安全的 `innerHTML`
  写入、运行时 `<style>` 注入和直接静态样式赋值。
- 将 HugeRTE UI 样式固定打包进 `styles.css`，并保留编辑器内容样式隔离。
- 为 HTML 片段解析增加安全 DOM 构造与 head/body 上下文迁移检测。
- 将本地 CLI 的 Node.js 模块改为 Desktop 条件动态加载，并统一窗口定时器、
  加密和文件删除 API。
- 用 Obsidian 确认弹窗替代浏览器 `confirm`，并按官方规范调整命令名称。
- 接入 `eslint-plugin-obsidianmd`，将审核规则固化为 `npm run lint`。

### English

- Clear all blocking Obsidian review errors, including unsafe `innerHTML`
  writes, runtime `<style>` injection, and direct static style assignment.
- Bundle the pinned HugeRTE UI skin in `styles.css` while preserving isolated
  editor content styling.
- Add safe HTML fragment construction and head/body context-migration checks.
- Guard local CLI Node.js modules behind Desktop-only dynamic imports and use
  window-compatible timers, crypto, and file deletion APIs.
- Replace browser `confirm` with an Obsidian modal and align command names with
  the plugin guidelines.
- Add `eslint-plugin-obsidianmd` as the local `npm run lint` review gate.

## 0.2.1 — 2026-07-16

- Rename the plugin to **Galley Studio** with the unique Obsidian plugin ID
  `galley-studio`.
- Rename public view types and the release archive to prevent collisions with
  the existing marketplace plugin named `Galley`.
- Move the source repository to
  <https://github.com/kinrochen/Galley-Studio>.
- Keep `.galley.html`, sidecar metadata, settings structures, and other document
  contracts compatible with existing files.

## 0.2.0 — 2026-07-16

### 中文

- 将 Galley Studio 控制台改为可复用的 Obsidian 右侧边栏视图，并完善窄宽度响应式布局。
- 让 HTML 文件直接显示在文件管理器中；单击即可进入可复用的预览、可视化编辑和源码工作台。
- 改进 HTML 预览尺寸、源码格式化与语法高亮，以及生成结果中的 HTML 提取。
- 重做生成对话：展示初始提示词和模型轮次，修复空白气泡、滚动回顶、状态不一致和错误不可读问题。
- 优化插件内 Agent 流程，将文章、主题和内置 Skill 直接注入提示词，避免重复询问已提供的信息。
- 将插件内模型与本地 CLI 的生成超时统一调整为 30 分钟。
- 重做主题实验室，使主题草稿能够通过对话生成、预览并确认保存。
- 更新中英文文档、作者与捐赠信息，并补充
  [gzh-design-skill](https://github.com/isjiamu/gzh-design-skill) 的来源与许可证说明。

### English

- Open the Galley Studio console as a reusable Obsidian right-sidebar view with responsive narrow layouts.
- Show HTML files in the file explorer and open them directly in a reusable Preview, Visual Edit, and Source workbench.
- Improve preview sizing, formatted syntax-highlighted source editing, and HTML extraction from mixed model responses.
- Rebuild the generation conversation with the initial prompt, model rounds, stable scrolling, consistent states, and readable errors.
- Improve the in-plugin Agent workflow by injecting the article, theme, and bundled Skill directly instead of asking for known inputs again.
- Increase provider and local CLI generation timeouts to 30 minutes.
- Redesign Theme Lab around conversational draft generation, preview, and explicit save confirmation.
- Refresh bilingual documentation, author and funding metadata, and attribution for
  [gzh-design-skill](https://github.com/isjiamu/gzh-design-skill).
