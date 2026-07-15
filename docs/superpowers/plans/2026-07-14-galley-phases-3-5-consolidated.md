# Galley Phases 3–5 Consolidated Delivery Plan

> **Execution rule:** Phase 3、4、5 各自只有一个端到端交付任务和一个阶段级审查门禁。阶段内部可以并行分工，但不再为单个模块创建独立任务、独立进度项或独立审查循环。

**Goal:** 在已经完成的生成链和生产事务基础上，用三个纵向交付完成桌面工作台、多配置导出与移动预览、主题实验室与 0.1.0 发布。

**Frozen prerequisite:** Phase 1、Phase 2、Phase 3 的 `DocumentSession`、HugeRTE 边界和生产 `ObsidianWorkbenchVault` 均按现有 review-clean 提交继续使用，不推倒重做。

## Unified execution model

每个阶段按下面一个循环完成：

1. 阶段负责人固定 public contracts、文件所有权和集成顺序。
2. 子代理可按互不重叠的文件域并行实现，但这些只是阶段内部 workstream，不进入任务账本。
3. 阶段负责人统一完成 `main.ts`、共享样式、组合根和跨域集成。
4. 运行阶段聚焦测试、完整 typecheck、全量测试、build 和静态检查。
5. 对整个阶段 base→HEAD 只做一次独立审查。审查给出一份集中问题清单；若需修复，由同一实现团队一次性修复，再由同一 reviewer 定向复核。
6. 只有阶段门禁通过后才进入下一阶段。

内部 checkpoint commits 允许存在，但不会被当成独立交付或独立审查任务。每个阶段对用户只呈现一个完成状态。

---

## Phase 3 delivery — Complete desktop workbench

### Outcome

桌面用户可以从生成后的 `.galley.html` 完成“打开 → 可视化编辑 → 自动保存 → 冲突处理 → 历史恢复 → 关闭/重启后重新打开”的完整闭环，不需要编辑 HTML 代码。移动端不加载 HugeRTE。

### Included scope

本交付一次性吸收旧计划的 3.2a.3、3.3、3.4、3.5。已 review-clean 的 3.1、3.2、3.2a.1、3.2a.2 是冻结前置。

阶段内部 workstreams：

- 生产会话组合：严格 `.galley.html`/`.galley.json` 配对，共享 `ObsidianWorkbenchVault`、`GalleyDocumentRepository`、`HistoryRepository` 和 `DocumentSession`，暴露 history/recovery/quarantine 状态。
- 工作台壳层：工具栏、左侧流程/大纲/历史、中间画布、右侧属性，支持 preview/visual/source 模式和可靠 teardown。
- 可视化编辑：资源 URL 显示与保存还原、当前主题组件角色切换、段落/图片/链接/表格属性、大纲定位。
- 保存闭环：800 ms autosave、外部冲突、重载/另存副本/明确覆盖、20 个历史版本及恢复。
- 插件集成：生成成功后打开工作台，文件菜单只识别 `*.galley.html`，桌面能力门控。

### Key contracts and ownership

- 新增生产组合边界：`DocumentSessionOpener`、`ObsidianDocumentSessionOpener` 或等价接口。
- 复用且不得削弱：`ObsidianWorkbenchVault`、`GalleyDocumentRepository`、`HistoryRepository`、`DocumentSession`、`HtmlEditorAdapter`、`HugeRteAdapter`。
- 主要新增文件域：`src/workbench/**`、`src/preview/SafeHtmlPreview.ts`、`src/editor/EditorResourceResolver.ts`、`ThemeComponentCatalog.ts`、`ComponentTransformer.ts`。
- `src/main.ts`、`src/commands/GenerateCurrentArticle.ts`、`styles.css` 只由阶段集成负责人修改。

### Acceptance matrix

- 生成产物可以立即打开工作台；只接受规范化、同 stem 的 Galley pair。
- 编辑正文后 autosave 保持 HTML/sidecar hash 一致；关闭、重开和模拟插件重启后内容正确。
- 所有事务要么恢复，要么明确暴露 scoped quarantine；不得静默吞冲突或混合 pair。
- 外部修改后 autosave 停止，重载、另存副本、明确覆盖分别正确。
- 历史只保留最新 20 个版本；恢复后保持 dirty，下一次保存才写回主文档。
- editor display URL 不写入文件；保存后仍是 vault-relative resource path。
- 组件转换保留内容、`data-galley-source` 与当前主题样式，不跨主题臆造组件。
- preview iframe 无脚本；模式切换和关闭只销毁 adapter 一次。
- HugeRTE 只能编辑 body，完整 Authoring shell 不被破坏。
- 移动启动路径不静态导入或初始化 HugeRTE。

### Phase gate

```bash
npm test -- tests/documents tests/editor tests/workbench tests/preview tests/integration
npm run test:typecheck
npm test
npm run build
git diff --check
```

阶段审查覆盖整个 Phase 3 base→HEAD；通过后将进度标记为 `Phase 3 delivery/gate complete`。

---

## Phase 4 delivery — Export profiles and mobile preview

### Outcome

同一份独立 Authoring 文档可以导出标准网页、便携内联和微信公众号 HTML，支持富文本复制；桌面端提供完整导出 UI，移动端只提供安全只读预览。

### Included scope

一次性吸收旧计划 4.1–4.5：导出契约、三种 profile、WeChat 确定性转换与条件修复、clipboard/UI、移动安全预览和平台门控。

阶段内部 workstreams：

- 不可变 `ExportService`、sidecar export record、冲突安全写入。
- `StandardWebProfile`、`PortableInlineProfile`、`WechatProfile` 与 TypeScript `WechatValidator`。
- 仅在 WeChat 确定性校验失败后启用 Skill-loaded 模型修复，最多两轮。
- `RichTextClipboard`、`ExportPanel`、`GalleyPreviewView` 和显式 Galley 文件命令。

### Key contracts and ownership

- `ExportProfile`、`ExportService`、三个 profile/validator/repair、`RichTextClipboard`。
- `ExportPanel`、`SafeHtmlPreview`、`GalleyPreviewView`、`OpenGalleyPreview`。
- 修改 `GalleySidecar`、document repository、workbench、`main.ts`、`styles.css`。
- 新增 `assets/profiles/standard-web.md`、`portable-inline.md`、`wechat.md`。

### Acceptance matrix

- 三种导出顺序执行后，主 `.galley.html` 逐字节不变。
- 标准网页是安全完整 HTML；便携内联无外部 CSS、字体或脚本依赖。
- WeChat 输出是单一 `<section>` fragment、内联样式，文字节点使用 `<span leaf="">`。
- TypeScript validator 对 pinned Skill Python validator 的每类确定性错误都有 parity fixture。
- 标准网页和便携内联从不调用模型；WeChat 仅在失败后加载 Skill/`wechat.md`，最多两轮且只修改副本。
- 失败或取消不留下被误报成功的 sidecar record；已写出的独立导出文件保持可追溯。
- clipboard 同时提供 `text/html` 与 `text/plain`，fallback DOM 必须在 `finally` 清理。
- 移动端只注册 Galley preview，不注册生成、编辑、Skill import 或模型 repair。
- 不用 `registerExtensions(["html"])` 抢占普通 HTML；iframe 使用空 sandbox、限制性 CSP 和 no-referrer。
- 集成用例跑通“生成 → 编辑 → 三种导出 → 移动预览”。

### Phase gate

```bash
npm test -- tests/export tests/preview tests/workbench tests/integration
npm run test:typecheck
npm test
npm run build
git diff --check
```

阶段审查覆盖整个 Phase 4 base→HEAD；通过后再进入 Phase 5。

---

## Phase 5 delivery — Theme Lab, Skill packages, acceptance and 0.1.0 release

### Outcome

完成首版最后一个用户闭环：用文字和可选参考图生成自定义主题、整页预览、校验并显式保存；安全导入/激活 Skill ZIP；通过六主题验收、长文基准、许可证审计和标准发布包。

### Included scope

一次性吸收旧计划 5.1–5.6：自定义主题仓库和虚拟索引、AI Theme Lab、Skill package 管理、golden/acceptance/benchmark、文档/CI/license/release。

阶段内部 workstreams：

- 主题数据：manifest、原子持久化、启停/删除、theme ZIP、built-in + custom merged VFS。
- Theme Lab：Skill-loaded draft generation、可选 vision、component lint、scriptless full-page preview、显式 Save。
- Skill ZIP：解压前/中限额、路径与结构校验、存储、显式激活、失败回滚；脚本只保留为参考文本，永不执行。
- Release：六内置主题 recorded responses、完整工作流 acceptance、约 10,000 中文字符 long benchmark、secret scan、docs、CI、license audit 和 release ZIP。

### Key contracts and ownership

- 主题：`ThemeManifestV1`、`CustomThemeRepository`、`MergedThemeRepository`、`ThemeVirtualMount`、`ThemeArchive`。
- Theme Lab：`ThemeDraft`、`ThemeGenerationService`、`ComponentLibraryValidator`、`ThemeLabView`、`ThemePreview`。
- Skill package：`SkillArchiveImporter`、`SkillPackageValidator`、`ImportedSkillRepository`、`SkillPackageSettings`。
- Release：acceptance harness/fixtures、benchmark、license audit、release builder、CI 和用户/安全文档。

### Acceptance matrix

- 模型生成主题前实际读取 `SKILL.md`、theme index、`theme-generator.md` 和 common components。
- 草稿在用户确认前不进入主题仓库或模型索引；validation 有 error 时禁止保存。
- 无 vision capability 时不发送图片；仅接受显式选择且 magic bytes/MIME/10 MiB 均通过的 PNG/JPEG/WebP。
- 保存后的自定义主题可被新 Skill session 从 merged VFS 读取；启停、删除、导入、导出和 ID collision 正确。
- Skill ZIP 拒绝 traversal、absolute path、symlink、duplicate canonical path、oversize 和 missing files；导入不自动激活，激活失败保留旧版本。
- 六套内置主题全部通过“生成 → 编辑 → 三种导出”。
- tool-first 与完整 injection fallback 均有录制验收。
- 长文 source IDs 零遗漏、零重复；API key 不出现在 settings、logs、artifacts、diagnostics、fixtures 或 release。
- release ZIP 精确包含 `main.js`、`manifest.json`、`styles.css`、`LICENSE`、`THIRD_PARTY_NOTICES.md`。

### Final phase gate

```bash
npm run test:typecheck
npm test
npm run test:acceptance
npm run benchmark:long
npm run build
npm run audit:licenses
npm run release
npm test -- tests/release
git diff --check
```

Phase 5 独立审查通过即进入 whole-branch final gate，不再另拆主题、Skill、验收或 release 子任务。

---

## Final branch gate

- 三个阶段审查报告均为 APPROVE。
- 从项目 merge base 到 HEAD 的完整 scope、license、secret、mobile capability 和 release artifact 复核通过。
- 只在最终 gate 后进行 branch handoff/PR/merge 决策。
