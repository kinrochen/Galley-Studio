export const EN = {
  "common.action.cancel": "Cancel",
  "common.action.delete": "Delete",
  "common.action.duplicate": "Duplicate",
  "common.action.edit": "Edit",
  "common.action.import": "Import",
  "common.action.add": "Add",
  "common.action.remove": "Remove",
  "common.action.preview": "Preview",
  "common.action.save": "Save",
  "common.error.safe": "The operation failed. Check settings and try again.",
  "common.confirm.delete": "Delete “{target}”?",
  "common.confirm.activate": "Activate “{target}”?",
  "common.language.auto": "Auto",
  "common.language.en": "English",
  "common.language.zh": "中文",
  "common.status.idle": "Ready",
  "common.status.loading": "Working…",
  "common.status.complete": "Done.",
  "common.status.partial": "HTML was created, but metadata was not fully committed: {path}",
  "console.action.generate": "Generate HTML",
  "console.action.openArticles": "Open article library",
  "console.action.openThemeLab": "Create theme in Theme Lab",
  "console.action.openWorkbench": "Open workbench",
  "console.articles.empty": "No Galley Studio articles yet.",
  "console.articles.search": "Search articles",
  "console.articles.title": "Articles",
  "console.exports.description": "Create reusable configurations. Run document exports in the workbench.",
  "console.exports.duplicateName": "{name} copy",
  "console.exports.fileName": "Filename template",
  "console.exports.folder": "Output folder",
  "console.exports.id": "Configuration id",
  "console.exports.name": "Configuration name",
  "console.exports.profile": "Export profile",
  "console.exports.title": "Export configurations",
  "console.file.readFailed": "The selected file could not be read.",
  "console.home.context.empty": "Select a Markdown or Galley Studio document to begin.",
  "console.home.context.galley": "Current Galley Studio article",
  "console.home.context.markdown": "Current Markdown",
  "console.home.description": "Turn the current Markdown into an independent, visually editable HTML article.",
  "console.home.readiness.agent": "Generation Agent",
  "console.home.readiness.model": "Model",
  "console.home.readiness.skill": "Skill",
  "console.home.readiness.apiKey": "API key",
  "console.home.readiness.themes": "Themes",
  "console.home.readiness.configured": "Configured",
  "console.home.readiness.missing": "Not configured",
  "console.home.themesUnavailable": "No usable theme was loaded. Check the active Skill or theme settings.",
  "console.home.checkSettings": "Check settings",
  "console.home.notReady": "Choose an available generation Agent, active Skill, and theme before generating.",
  "console.home.viewAll": "View all",
  "console.home.articleMeta": "Theme {theme}",
  "console.home.continue": "Continue working",
  "console.home.metrics": "{words} words · {characters} characters",
  "console.home.activity.pendingExport": "Pending export: {path}",
  "console.home.activity.unsavedTheme": "Unsaved theme draft: {name}",
  "console.home.quick": "Quick management",
  "console.home.recent": "Recent articles",
  "console.home.recent.empty": "No recent Galley Studio articles.",
  "console.home.status": "System status",
  "console.home.status.summary": "{available} available · {unavailable} unavailable",
  "console.home.status.activeSkill": "Active Skill: {version}",
  "console.home.status.connectionNotChecked": "Connection not checked",
  "console.home.status.model": "Model: {model}",
  "console.home.status.themeCount": "{count} themes",
  "console.home.theme": "Choose a theme",
  "console.home.title": "Generate an HTML article",
  "console.language.aria": "Language",
  "console.mobile.previewOnly": "Preview only on mobile",
  "console.nav.articles": "Articles",
  "console.nav.generation": "Generation",
  "console.nav.exports": "Export configurations",
  "console.nav.home": "Console",
  "console.nav.settings": "Settings",
  "console.nav.themes": "Themes",
  "console.ribbon": "Open Galley Studio console",
  "console.generation.title": "Generation conversation",
  "console.generation.description": "Follow every generation stage and the visible model output. This task keeps running when the console is closed.",
  "console.generation.empty": "No generation task has been started in this Obsidian session.",
  "console.generation.new": "Start a new generation",
  "console.generation.source": "Source",
  "console.generation.elapsed": "Elapsed",
  "console.generation.rounds": "Model rounds",
  "console.generation.modelRound": "Model · round {round} · {duration}",
  "console.generation.prompt": "You · initial prompt",
  "console.generation.youAvatar": "You",
  "console.generation.agentAvatar": "AI",
  "console.generation.waitingOutput": "Waiting for visible model output…",
  "console.generation.truncated": "Earlier output in this round was folded to keep the console responsive.",
  "console.generation.system": "Galley Studio",
  "console.generation.backgroundHint": "Generation is running in the background. You may close this console and return later.",
  "console.generation.completed": "Generation completed and saved: {path}",
  "console.generation.running": "Running",
  "console.generation.succeeded": "Completed",
  "console.generation.failed": "Generation failed.",
  "console.generation.cancelled": "Generation cancelled.",
  "console.settings.baseUrl": "Base URL",
  "console.settings.description": "Choose the Agent Galley Studio uses to generate the final HTML file.",
  "console.settings.agent": "Generation Agent",
  "console.settings.agentDescription": "Use Galley Studio's provider connection or a local authenticated CLI. Local executables are detected automatically.",
  "console.settings.agent.plugin": "Galley Studio Agent",
  "console.settings.agent.codex": "Local Codex CLI",
  "console.settings.agent.claude": "Local Claude Code CLI",
  "console.settings.codexPath": "Codex executable",
  "console.settings.claudePath": "Claude executable",
  "console.settings.cliDiscovery": "CLI executable",
  "console.settings.cliDiscoveryDescription": "Galley Studio automatically scans desktop app bundles, the Obsidian PATH, and common system and user-level install locations. The availability check runs one minimal model call.",
  "console.settings.provider": "Model provider",
  "console.settings.providerDescription": "OpenAI-compatible endpoint, model, and SecretStorage key.",
  "console.settings.generation": "Generation defaults",
  "console.settings.generationDescription": "Request limits and where independent article files are saved.",
  "console.settings.diagnosticTitle": "Agent availability",
  "console.settings.diagnosticDescription": "Run one minimal model call to verify that the selected Agent can respond. The bundled Skill is not part of this check.",
  "console.settings.contextWindow": "Context window",
  "console.settings.diagnostic": "Check Agent availability",
  "console.settings.language": "Display language: {language}",
  "console.settings.model": "Model",
  "console.settings.outputFolder": "Output folder",
  "console.settings.secret": "API key",
  "console.settings.secretUnavailable": "{id} (unavailable)",
  "console.settings.secretUnavailableHelp": "The selected SecretStorage key no longer exists. Select an available key before generating.",
  "console.settings.temperature": "Temperature",
  "console.settings.timeout": "Timeout (ms)",
  "console.settings.title": "Settings",
  "console.themes.disable": "Disable",
  "console.themes.description": "Use a built-in theme, manage custom themes, or create one with AI.",
  "console.themes.empty": "No themes are available from the active Skill.",
  "console.themes.builtIn": "Built in",
  "console.themes.custom": "Custom",
  "console.themes.enable": "Enable",
  "console.themes.export": "Export",
  "console.themes.preview": "Preview of {theme}",
  "console.themes.title": "Themes",
  "console.title": "Galley Studio console",
  "console.unavailable": "Unavailable: {reason}",
  "console.unavailable.missingSidecar": "Missing metadata sidecar",
  "console.unavailable.missingHtml": "Missing HTML file",
  "console.unavailable.invalidSidecar": "Invalid metadata sidecar",
  "console.unavailable.invalidDocument": "Invalid Galley Studio document",
  "console.unavailable.hashMismatch": "HTML hash mismatch",
  "console.unavailable.unreadable": "File could not be read",
  "generation.notice.reading": "Galley Studio: Reading current Markdown.",
  "generation.notice.loading": "Galley Studio: Loading generation dependencies.",
  "generation.notice.generating": "Galley Studio: Generating article.",
  "generation.notice.validating": "Galley Studio: The Agent is following the Skill.",
  "generation.notice.saving": "Galley Studio: Saving the final HTML file.",
  "generation.notice.generated": "Galley Studio: Generated {html}.",
  "generation.notice.unverified": "Galley Studio: Saved UNVERIFIED DRAFT {html} and {sidecar}.",
  "generation.notice.openFailed": "Galley Studio: The article was generated, but the workbench could not open it.",
  "generation.status.inProgress": "Reading Markdown, loading the Skill, and generating HTML…",
  "generation.status.reading": "1/4 Reading the Markdown source…",
  "generation.status.loadingSkill": "2/4 Connecting to the Agent and loading the Skill…",
  "generation.status.generating": "3/4 The Agent is using the Skill to generate HTML…",
  "generation.status.validating": "3/4 The Agent is using the Skill to generate HTML…",
  "generation.status.saving": "4/4 Saving the one final HTML file…",
  "generation.status.complete": "Generated and opened: {path}",
  "generation.error.cancelled": "Galley Studio: Generation cancelled.",
  "generation.error.cliNotFound": "Galley Studio: The selected local CLI was not found. Check its executable path in Settings.",
  "generation.error.cliFailed": "Galley Studio: The local CLI exited with an error. Check that it is signed in and can run from a terminal.",
  "generation.error.missingMarkdown": "Galley Studio: Open one Markdown file before generating.",
  "generation.error.missingModel": "Galley Studio: Configure a model before generating.",
  "generation.error.outputFolder": "Galley Studio: Configure a valid vault-relative output folder.",
  "generation.error.missingSecret": "Galley Studio: Configure an API key before generating.",
  "generation.error.baseUrl": "Galley Studio: Check the configured provider Base URL.",
  "generation.error.timeout": "Galley Studio: The model did not finish within 30 minutes. Retry or use a faster model.",
  "generation.error.authorization": "Galley Studio: The provider rejected the API key or permissions.",
  "generation.error.providerUnavailable": "Galley Studio: The provider is temporarily unavailable; try again.",
  "generation.error.compatibility": "Galley Studio: The provider rejected this OpenAI-compatible request. Check the endpoint and model compatibility.",
  "generation.error.requestTooLarge": "Galley Studio: The provider rejected the request as too large. Reduce the article or context size.",
  "generation.error.network": "Galley Studio: Could not reach the model provider. Check the Base URL and network.",
  "generation.error.invalidResponse": "Galley Studio: The model returned an unreadable response. Try again or choose another compatible model.",
  "generation.error.skillLoading": "Galley Studio: The model did not finish loading the Skill files. Try again or use a model with reliable tool calling.",
  "generation.error.themeDecision": "Galley Studio: The model could not choose a valid theme. Select one of the available themes and generate again.",
  "generation.error.inputInvalid": "Galley Studio: The current Markdown could not be prepared for generation.",
  "generation.error.longBlock": "Galley Studio: One Markdown block is too large for the configured context window.",
  "generation.error.empty": "Galley Studio: The Agent returned no usable article body after repair, so no blank HTML file was saved.",
  "generation.error.failed": "Galley Studio: Generation failed. Check settings and try again."
  ,"fileMenu.preview": "Open Galley Studio preview"
  ,"fileMenu.workbench": "Open in Galley Studio workbench"
  ,"preview.frameTitle": "Galley Studio article preview"
  ,"preview.title": "Galley Studio preview"
  ,"settings.baseUrl.desc": "OpenAI-compatible API base URL."
  ,"settings.cliPath.desc": "Command name or absolute path. The CLI uses its existing local sign-in."
  ,"settings.contextWindow.desc": "Maximum model context window in tokens."
  ,"settings.diagnostic.desc": "Run one minimal model call. The bundled Skill is used directly and is not checked here."
  ,"settings.diagnostic.name": "Agent availability"
  ,"settings.language.desc": "Follow Obsidian or choose a Galley Studio display language."
  ,"settings.language.name": "Language"
  ,"settings.model.desc": "Model identifier sent to the provider."
  ,"settings.outputFolder.desc": "Vault folder for generated Galley Studio files."
  ,"settings.secret.desc": "Select a key stored in Obsidian SecretStorage."
  ,"settings.temperature.desc": "Sampling temperature from 0 to 2."
  ,"settings.timeout.desc": "Generation requests use a fixed 30-minute timeout (1800000 ms)."
  ,"themeLab.assistant": "Galley Studio"
  ,"themeLab.assistant.finalizing": "I’m turning the approved preview into the complete reusable theme and saving it…"
  ,"themeLab.assistant.generating": "I’m generating a new theme draft from the full conversation…"
  ,"themeLab.assistant.invalid": "The draft was generated, but it has {count} validation issue(s). Continue the conversation and ask me to revise it."
  ,"themeLab.assistant.saved": "“{name}” is saved. It is now available when you generate new articles."
  ,"themeLab.assistant.valid": "I generated “{name}” with {color} as its primary color. Review the preview, continue with changes, or save it when you are satisfied."
  ,"themeLab.assistant.welcome": "Describe the visual direction you want: mood, colors, typography, layout, and suitable article types. I’ll quickly generate a lightweight preview. You can keep sending changes; the complete theme is built only when you save."
  ,"themeLab.conversation.aria": "Theme design conversation"
  ,"themeLab.description.aria": "Theme description"
  ,"themeLab.description.placeholder": "Describe a theme, or tell Galley Studio what to change… (⌘/Ctrl + Enter to send)"
  ,"themeLab.error.collision": "A theme with this id already exists. Ask Galley Studio to use a different theme name, then save again."
  ,"themeLab.error.invalidResponse": "The model did not return a readable theme package. Save again to retry."
  ,"themeLab.error.missingSecret": "No API key is available for theme generation."
  ,"themeLab.error.provider": "The model provider could not complete the theme. Check the connection and retry."
  ,"themeLab.error.timeout": "Complete theme generation timed out. Save again or use a faster model."
  ,"themeLab.error.validation": "The complete theme did not pass validation. Save again to regenerate it."
  ,"themeLab.generate.initial": "Generate first draft"
  ,"themeLab.generate.refine": "Send changes"
  ,"themeLab.image.aria": "Optional reference image"
  ,"themeLab.image.tooLarge": "A theme reference image must be no larger than 10 MiB."
  ,"themeLab.intro": "Iterate quickly with lightweight previews. Galley Studio builds the complete reusable theme only after you explicitly save it."
  ,"themeLab.issue.invalid": "The theme draft contains a validation issue."
  ,"themeLab.issue.designVariables": "The component library is missing design variables."
  ,"themeLab.issue.componentHtml": "The component library is missing complete component HTML."
  ,"themeLab.issue.template": "The component library is missing an article template skeleton."
  ,"themeLab.issue.recipes": "The component library is missing article-type recipes."
  ,"themeLab.issue.mapping": "The component library is missing Markdown mapping."
  ,"themeLab.issue.oversize": "The component library exceeds 5 MiB."
  ,"themeLab.issue.htmlMissing": "The component library has no HTML component fences."
  ,"themeLab.issue.forbiddenElement": "Component HTML contains a forbidden element."
  ,"themeLab.issue.forbiddenAttribute": "Component HTML contains a forbidden attribute or style."
  ,"themeLab.issue.whiteSpace": "Component HTML must not use white-space: pre."
  ,"themeLab.issue.dashedBorder": "Four-sided dashed borders should be reserved for centered media placeholders."
  ,"themeLab.issue.leaf": "Every component text node must be wrapped by an approved leaf span."
  ,"themeLab.issue.previewDocument": "The theme preview is not a valid full HTML document."
  ,"themeLab.issue.previewScript": "The theme preview contains a script."
  ,"themeLab.issue.previewEvent": "The theme preview contains an event handler."
  ,"themeLab.issue.previewCount": "The lightweight preview must contain 8 to 12 marked blocks."
  ,"themeLab.issue.previewSequence": "Theme preview markers must be consecutive and in DOM order."
  ,"themeLab.notice.saved": "Saved custom theme: {name}"
  ,"themeLab.preview.heading": "Live theme preview"
  ,"themeLab.preview.title": "Galley Studio custom theme full-page preview"
  ,"themeLab.save": "Save theme"
  ,"themeLab.status.cancelled": "Theme generation cancelled."
  ,"themeLab.status.drafting": "Generating a lightweight preview… {seconds}s"
  ,"themeLab.status.finalizing": "Building the complete theme package… {seconds}s"
  ,"themeLab.status.generating": "Generating theme draft…"
  ,"themeLab.status.invalid": "Draft has validation errors and cannot be saved."
  ,"themeLab.status.loadingRules": "Loading complete theme rules… {seconds}s"
  ,"themeLab.status.operationFailed": "Theme operation failed."
  ,"themeLab.status.saved": "Theme saved and available to new Skill sessions."
  ,"themeLab.status.saving": "Saving the completed theme… {seconds}s"
  ,"themeLab.status.valid": "Lightweight preview is ready. Continue refining it, or save to build the complete theme."
  ,"themeLab.status.validating": "Validating the generated theme… {seconds}s"
  ,"themeLab.title": "AI Theme Lab"
  ,"themeLab.you": "You"
  ,"workbench.conflict.copy": "Save a copy"
  ,"workbench.conflict.message": "This article changed outside Galley Studio. Choose how to continue."
  ,"workbench.conflict.overwrite": "Overwrite external"
  ,"workbench.conflict.reload": "Reload external"
  ,"workbench.export.configuration": "Export configuration"
  ,"workbench.export.copy": "Copy rich text"
  ,"workbench.export.empty": "No export configurations."
  ,"workbench.export.file": "Export file"
  ,"workbench.export.filename": "Filename"
  ,"workbench.export.folder": "Output folder"
  ,"workbench.export.invalid": "Export configuration is invalid"
  ,"workbench.export.profile.standardWeb": "Standard web"
  ,"workbench.export.profile.portableInline": "Portable inline"
  ,"workbench.export.profile.wechat": "WeChat editor"
  ,"workbench.export.status.copying": "Copying…"
  ,"workbench.export.status.exporting": "Exporting…"
  ,"workbench.export.status.copied": "Copied: {path}"
  ,"workbench.export.status.exported": "Exported: {path}"
  ,"workbench.export.status.previous": "Exported {path} for the previous document"
  ,"workbench.export.status.saveFailed": "Configuration save failed"
  ,"workbench.export.status.recordedAfterCancellation": "Exported {path}; record committed before cancellation"
  ,"workbench.export.status.recordNotRecorded": "Exported {path}; sidecar record not recorded"
  ,"workbench.export.status.recordAmbiguous": "Exported {path}; sidecar record outcome ambiguous"
  ,"workbench.export.status.artifactAmbiguous": "Export outcome ambiguous at {path}"
  ,"workbench.export.status.copyFailedAfterExport": "Exported {path}; copy failed"
  ,"workbench.export.status.copyFailed": "Copy failed"
  ,"workbench.export.status.exportFailed": "Export failed"
  ,"workbench.export.name": "Name"
  ,"workbench.export.profile": "Profile"
  ,"workbench.export.save": "Save configuration"
  ,"workbench.export.saved": "Saved configuration"
  ,"workbench.history.empty": "No saved versions yet."
  ,"workbench.history.title": "History"
  ,"workbench.mode.preview": "Preview"
  ,"workbench.mode.source": "Source"
  ,"workbench.mode.visual": "Edit"
  ,"workbench.copyWechat": "Copy for WeChat"
  ,"workbench.copyWechat.success": "Copied WeChat-compatible rich text."
  ,"workbench.copyWechat.failed": "Could not copy WeChat-compatible rich text: {reason}"
  ,"workbench.copySource": "Copy source"
  ,"workbench.copySource.success": "Copied the complete HTML source."
  ,"workbench.copySource.failed": "Could not copy the HTML source."
  ,"workbench.source.format": "Format HTML"
  ,"workbench.source.language": "HTML source"
  ,"workbench.outline.title": "Outline"
  ,"workbench.properties.componentRole": "Component role"
  ,"workbench.properties.paragraph": "Paragraph"
  ,"workbench.properties.spacing": "Paragraph spacing"
  ,"workbench.properties.title": "Properties"
  ,"workbench.properties.backgroundColor": "Background color"
  ,"workbench.properties.alignment.left": "Left"
  ,"workbench.properties.alignment.center": "Center"
  ,"workbench.properties.alignment.right": "Right"
  ,"workbench.properties.alignment.justify": "Justify"
  ,"workbench.properties.imageAlt": "Image alternative text"
  ,"workbench.properties.imageCaption": "Image caption"
  ,"workbench.properties.linkUrl": "Link URL"
  ,"workbench.properties.linkTitle": "Link title"
  ,"workbench.properties.row": "row"
  ,"workbench.properties.column": "column"
  ,"workbench.properties.tableAction": "{action} {dimension}"
  ,"workbench.properties.textColor": "Text color"
  ,"workbench.save": "Save"
  ,"workbench.sourceChanged": "Source changed"
  ,"workbench.status.conflict": "Conflict"
  ,"workbench.status.saved": "Saved"
  ,"workbench.status.saving": "Saving…"
  ,"workbench.status.unsaved": "Unsaved"
  ,"workbench.title": "Galley Studio workbench"
  ,"workbench.warning.recovery": "Recovery requires attention."
  ,"workbench.error.openAmbiguous": "The last transaction outcome is ambiguous. No partial document was opened."
  ,"workbench.error.openQuarantined": "Recovery is quarantined for this document. No file was changed."
  ,"workbench.error.recoveryAmbiguous": "The last transaction outcome is ambiguous. Saving is paused until recovery completes."
  ,"workbench.error.editorInit": "Galley Studio could not initialize this editor mode."
  ,"workbench.error.invalidEdit": "Galley Studio rejected an unsafe or invalid body edit."
  ,"workbench.error.saveQuarantined": "Recovery is quarantined for this document. No file was overwritten."
  ,"workbench.error.saveAmbiguous": "Galley Studio could not prove the save outcome. Recovery must complete before another save."
  ,"workbench.error.saveFailed": "Galley Studio could not save this article."
  ,"workbench.confirm.reload": "Discard local edits and reload the external file?"
  ,"workbench.confirm.overwrite": "Overwrite the external file with the local Galley Studio edit?"
  ,"workbench.workflow": "Generate → Edit → Export"
  ,"diagnostic.title": "Agent availability"
  ,"diagnostic.status": "Model call"
  ,"diagnostic.passed": "Available"
  ,"diagnostic.failed": "Unavailable"
  ,"diagnostic.model": "Agent / model"
  ,"diagnostic.errorCode": "Error code"
  ,"diagnostic.notice.passed": "Galley Studio Agent is available."
  ,"diagnostic.notice.failed": "Galley Studio Agent is unavailable ({code})."
} as const;

export type MessageKey = keyof typeof EN;
export type MessageResources = Readonly<Record<MessageKey, string>>;

export const ZH_CN: MessageResources = {
  "common.action.cancel": "取消",
  "common.action.delete": "删除",
  "common.action.duplicate": "复制",
  "common.action.edit": "编辑",
  "common.action.import": "导入",
  "common.action.add": "添加",
  "common.action.remove": "移除",
  "common.action.preview": "预览",
  "common.action.save": "保存",
  "common.error.safe": "操作失败，请检查设置后重试。",
  "common.confirm.delete": "删除“{target}”？",
  "common.confirm.activate": "激活“{target}”？",
  "common.language.auto": "自动",
  "common.language.en": "English",
  "common.language.zh": "中文",
  "common.status.idle": "就绪",
  "common.status.loading": "处理中…",
  "common.status.complete": "已完成。",
  "common.status.partial": "HTML 已生成，但元数据未完整提交：{path}",
  "console.action.generate": "生成 HTML",
  "console.action.openArticles": "打开文章库",
  "console.action.openThemeLab": "在主题实验室中创建主题",
  "console.action.openWorkbench": "打开工作台",
  "console.articles.empty": "暂无 Galley Studio 文章。",
  "console.articles.search": "搜索文章",
  "console.articles.title": "文章",
  "console.exports.description": "创建可复用配置。文档导出请在工作台中执行。",
  "console.exports.duplicateName": "{name} 副本",
  "console.exports.fileName": "文件名模板",
  "console.exports.folder": "输出文件夹",
  "console.exports.id": "配置 ID",
  "console.exports.name": "配置名称",
  "console.exports.profile": "导出类型",
  "console.exports.title": "导出配置",
  "console.file.readFailed": "无法读取所选文件。",
  "console.home.context.empty": "请选择 Markdown 或 Galley Studio 文档开始。",
  "console.home.context.galley": "当前 Galley Studio 文章",
  "console.home.context.markdown": "当前 Markdown",
  "console.home.description": "将当前 Markdown 转换为独立、可视化编辑的 HTML 文章。",
  "console.home.readiness.agent": "生成 Agent",
  "console.home.readiness.model": "模型",
  "console.home.readiness.skill": "Skill",
  "console.home.readiness.apiKey": "API 密钥",
  "console.home.readiness.themes": "主题",
  "console.home.readiness.configured": "已配置",
  "console.home.readiness.missing": "未配置",
  "console.home.themesUnavailable": "没有加载到可用主题，请检查当前 Skill 或主题设置。",
  "console.home.checkSettings": "检查设置",
  "console.home.notReady": "请先选择可用的生成 Agent、当前 Skill 和主题。",
  "console.home.viewAll": "查看全部",
  "console.home.articleMeta": "主题 {theme}",
  "console.home.continue": "继续工作",
  "console.home.metrics": "{words} 字词 · {characters} 字符",
  "console.home.activity.pendingExport": "待处理导出：{path}",
  "console.home.activity.unsavedTheme": "未保存主题草稿：{name}",
  "console.home.quick": "快捷管理",
  "console.home.recent": "最近文章",
  "console.home.recent.empty": "暂无最近的 Galley Studio 文章。",
  "console.home.status": "系统状态",
  "console.home.status.summary": "{available} 篇可用 · {unavailable} 篇不可用",
  "console.home.status.activeSkill": "当前技能：{version}",
  "console.home.status.connectionNotChecked": "连接尚未检查",
  "console.home.status.model": "模型：{model}",
  "console.home.status.themeCount": "{count} 个主题",
  "console.home.theme": "选择主题",
  "console.home.title": "生成 HTML 文章",
  "console.language.aria": "语言",
  "console.mobile.previewOnly": "移动端仅支持预览",
  "console.nav.articles": "文章",
  "console.nav.generation": "生成对话",
  "console.nav.exports": "导出配置",
  "console.nav.home": "控制台",
  "console.nav.settings": "设置",
  "console.nav.themes": "主题",
  "console.ribbon": "打开 Galley Studio 控制台",
  "console.generation.title": "生成对话",
  "console.generation.description": "查看每个生成阶段和模型可见输出。关闭控制台后，任务仍会在后台继续。",
  "console.generation.empty": "本次 Obsidian 会话中还没有启动生成任务。",
  "console.generation.new": "开始新的生成",
  "console.generation.source": "源文件",
  "console.generation.elapsed": "已用时间",
  "console.generation.rounds": "模型轮次",
  "console.generation.modelRound": "模型 · 第 {round} 轮 · {duration}",
  "console.generation.prompt": "你 · 初始提示词",
  "console.generation.youAvatar": "你",
  "console.generation.agentAvatar": "AI",
  "console.generation.waitingOutput": "正在等待模型输出…",
  "console.generation.truncated": "为保持控制台流畅，本轮较早的输出已折叠。",
  "console.generation.system": "Galley Studio",
  "console.generation.backgroundHint": "任务正在后台生成。你可以关闭控制台，稍后再回来查看。",
  "console.generation.completed": "生成完成并已保存：{path}",
  "console.generation.running": "生成中",
  "console.generation.succeeded": "已完成",
  "console.generation.failed": "生成失败。",
  "console.generation.cancelled": "生成已取消。",
  "console.settings.baseUrl": "基础 URL",
  "console.settings.description": "选择 Galley Studio 用来生成最终 HTML 文件的 Agent。",
  "console.settings.agent": "生成 Agent",
  "console.settings.agentDescription": "使用 Galley Studio 自带的模型连接，或本机已登录的 CLI；本地可执行文件会自动探测。",
  "console.settings.agent.plugin": "本插件 Agent",
  "console.settings.agent.codex": "本地 Codex CLI",
  "console.settings.agent.claude": "本地 Claude Code CLI",
  "console.settings.codexPath": "Codex 可执行文件",
  "console.settings.claudePath": "Claude 可执行文件",
  "console.settings.cliDiscovery": "CLI 可执行文件",
  "console.settings.cliDiscoveryDescription": "Galley Studio 会自动扫描桌面应用内置 CLI、Obsidian PATH、常见系统目录和用户级安装目录；可用性检查只发起一次最小模型调用。",
  "console.settings.provider": "模型服务",
  "console.settings.providerDescription": "OpenAI 兼容端点、模型和 SecretStorage 密钥。",
  "console.settings.generation": "生成默认值",
  "console.settings.generationDescription": "请求限制，以及独立文章文件的保存位置。",
  "console.settings.diagnosticTitle": "Agent 可用性检查",
  "console.settings.diagnosticDescription": "发起一次最小模型调用，只确认当前 Agent 能否正常响应；内置 Skill 不参与检查。",
  "console.settings.contextWindow": "上下文窗口",
  "console.settings.diagnostic": "检查 Agent 可用性",
  "console.settings.language": "显示语言：{language}",
  "console.settings.model": "模型",
  "console.settings.outputFolder": "输出文件夹",
  "console.settings.secret": "API 密钥",
  "console.settings.secretUnavailable": "{id}（不可用）",
  "console.settings.secretUnavailableHelp": "当前 SecretStorage 密钥已不存在，请选择可用密钥后再生成。",
  "console.settings.temperature": "温度",
  "console.settings.timeout": "超时（毫秒）",
  "console.settings.title": "设置",
  "console.themes.disable": "停用",
  "console.themes.description": "使用内置主题、管理自定义主题，或通过 AI 创建新主题。",
  "console.themes.empty": "当前 Skill 没有提供可用主题。",
  "console.themes.builtIn": "内置",
  "console.themes.custom": "自定义",
  "console.themes.enable": "启用",
  "console.themes.export": "导出",
  "console.themes.preview": "{theme} 主题预览",
  "console.themes.title": "主题",
  "console.title": "Galley Studio 控制台",
  "console.unavailable": "不可用：{reason}",
  "console.unavailable.missingSidecar": "缺少元数据侧车文件",
  "console.unavailable.missingHtml": "缺少 HTML 文件",
  "console.unavailable.invalidSidecar": "元数据侧车文件无效",
  "console.unavailable.invalidDocument": "Galley Studio 文档无效",
  "console.unavailable.hashMismatch": "HTML 哈希不匹配",
  "console.unavailable.unreadable": "文件无法读取",
  "generation.notice.reading": "Galley Studio：正在读取当前 Markdown。",
  "generation.notice.loading": "Galley Studio：正在加载生成依赖。",
  "generation.notice.generating": "Galley Studio：正在生成文章。",
  "generation.notice.validating": "Galley Studio：Agent 正在按 Skill 生成。",
  "generation.notice.saving": "Galley Studio：正在保存最终 HTML 文件。",
  "generation.notice.generated": "Galley Studio：已生成 {html}。",
  "generation.notice.unverified": "Galley Studio：已保存未验证草稿 {html} 和 {sidecar}。",
  "generation.notice.openFailed": "Galley Studio：文章已生成，但无法打开工作台。",
  "generation.status.inProgress": "正在读取 Markdown、加载 Skill 并生成 HTML…",
  "generation.status.reading": "1/4 正在读取 Markdown 源文件…",
  "generation.status.loadingSkill": "2/4 正在连接 Agent 并加载 Skill…",
  "generation.status.generating": "3/4 Agent 正在使用 Skill 生成 HTML…",
  "generation.status.validating": "3/4 Agent 正在使用 Skill 生成 HTML…",
  "generation.status.saving": "4/4 正在保存唯一的最终 HTML 文件…",
  "generation.status.complete": "已生成并打开：{path}",
  "generation.error.cancelled": "Galley Studio：生成已取消。",
  "generation.error.cliNotFound": "Galley Studio：找不到所选的本地 CLI，请检查设置中的可执行文件路径。",
  "generation.error.cliFailed": "Galley Studio：本地 CLI 执行失败，请确认它已登录且能在终端中正常运行。",
  "generation.error.missingMarkdown": "Galley Studio：请先打开一个 Markdown 文件。",
  "generation.error.missingModel": "Galley Studio：请先配置模型。",
  "generation.error.outputFolder": "Galley Studio：请配置有效的仓库相对输出文件夹。",
  "generation.error.missingSecret": "Galley Studio：请先配置 API 密钥。",
  "generation.error.baseUrl": "Galley Studio：请检查服务商基础 URL。",
  "generation.error.timeout": "Galley Studio：模型未在 30 分钟内完成，请重试或更换响应更快的模型。",
  "generation.error.authorization": "Galley Studio：服务商拒绝了 API 密钥或权限。",
  "generation.error.providerUnavailable": "Galley Studio：服务商暂时不可用，请稍后重试。",
  "generation.error.compatibility": "Galley Studio：服务商拒绝了当前 OpenAI 兼容请求，请检查端点与模型兼容性。",
  "generation.error.requestTooLarge": "Galley Studio：请求内容过大，请缩短文章或上下文。",
  "generation.error.network": "Galley Studio：无法连接模型服务，请检查基础 URL 和网络。",
  "generation.error.invalidResponse": "Galley Studio：模型返回了无法读取的响应，请重试或更换兼容模型。",
  "generation.error.skillLoading": "Galley Studio：模型未能完成 Skill 文件加载，请重试或使用工具调用更稳定的模型。",
  "generation.error.themeDecision": "Galley Studio：模型未能选择有效主题，请明确选择一个可用主题后重新生成。",
  "generation.error.inputInvalid": "Galley Studio：当前 Markdown 无法进入生成流程。",
  "generation.error.longBlock": "Galley Studio：Markdown 中有单个区块超出当前上下文窗口。",
  "generation.error.empty": "Galley Studio：Agent 修复后仍未返回可用正文，因此没有保存空白 HTML 文件。",
  "generation.error.failed": "Galley Studio：生成失败，请检查设置后重试。"
  ,"fileMenu.preview": "打开 Galley Studio 预览"
  ,"fileMenu.workbench": "在 Galley Studio 工作台中打开"
  ,"preview.frameTitle": "Galley Studio 文章预览"
  ,"preview.title": "Galley Studio 预览"
  ,"settings.baseUrl.desc": "OpenAI 兼容 API 的基础 URL。"
  ,"settings.cliPath.desc": "填写命令名或绝对路径；CLI 会使用本机现有的登录状态。"
  ,"settings.contextWindow.desc": "模型上下文窗口的最大 token 数。"
  ,"settings.diagnostic.desc": "发起一次最小模型调用；内置 Skill 直接使用，不在这里检查。"
  ,"settings.diagnostic.name": "Agent 可用性检查"
  ,"settings.language.desc": "跟随 Obsidian，或选择 Galley Studio 显示语言。"
  ,"settings.language.name": "语言"
  ,"settings.model.desc": "发送给服务商的模型标识。"
  ,"settings.outputFolder.desc": "生成 Galley Studio 文件的仓库文件夹。"
  ,"settings.secret.desc": "选择存储在 Obsidian SecretStorage 中的密钥。"
  ,"settings.temperature.desc": "0 到 2 之间的采样温度。"
  ,"settings.timeout.desc": "生成请求固定使用 30 分钟超时（1800000 毫秒）。"
  ,"themeLab.assistant": "Galley Studio"
  ,"themeLab.assistant.finalizing": "我正在把确认过的预览生成完整可复用主题并保存……"
  ,"themeLab.assistant.generating": "我正在根据完整对话生成新的主题草稿…"
  ,"themeLab.assistant.invalid": "草稿已生成，但还有 {count} 个验证问题。请继续告诉我如何调整。"
  ,"themeLab.assistant.saved": "“{name}”已保存，之后生成新文章时可以直接使用。"
  ,"themeLab.assistant.valid": "我已生成“{name}”，主色为 {color}。你可以检查预览、继续提出修改，满意后再保存。"
  ,"themeLab.assistant.welcome": "告诉我你想要的视觉方向，例如氛围、色彩、字体、版式和适用文章类型。我会先快速生成轻量预览，你可以继续修改；只有保存时才会生成完整主题。"
  ,"themeLab.conversation.aria": "主题设计对话"
  ,"themeLab.description.aria": "主题描述"
  ,"themeLab.description.placeholder": "描述主题，或告诉 Galley Studio 还要修改什么……（⌘/Ctrl + Enter 发送）"
  ,"themeLab.error.collision": "相同 ID 的主题已存在，请让 Galley Studio 更换主题名称后再保存。"
  ,"themeLab.error.invalidResponse": "模型没有返回可读取的主题包，请再次点击保存重试。"
  ,"themeLab.error.missingSecret": "没有可用于主题生成的 API 密钥。"
  ,"themeLab.error.provider": "模型服务未能完成主题生成，请检查连接后重试。"
  ,"themeLab.error.timeout": "完整主题生成超时，请再次保存或换用更快的模型。"
  ,"themeLab.error.validation": "完整主题未通过校验，请再次点击保存重新生成。"
  ,"themeLab.generate.initial": "生成第一个草稿"
  ,"themeLab.generate.refine": "发送修改意见"
  ,"themeLab.image.aria": "可选参考图"
  ,"themeLab.image.tooLarge": "主题参考图不得超过 10 MiB。"
  ,"themeLab.intro": "通过轻量预览快速迭代。只有明确点击保存后，Galley Studio 才会生成完整可复用主题并加入主题库。"
  ,"themeLab.issue.invalid": "主题草稿存在验证问题。"
  ,"themeLab.issue.designVariables": "组件库缺少设计变量。"
  ,"themeLab.issue.componentHtml": "组件库缺少完整组件 HTML。"
  ,"themeLab.issue.template": "组件库缺少完整文章模板骨架。"
  ,"themeLab.issue.recipes": "组件库缺少文章类型组合配方。"
  ,"themeLab.issue.mapping": "组件库缺少 Markdown 映射。"
  ,"themeLab.issue.oversize": "组件库超过 5 MiB。"
  ,"themeLab.issue.htmlMissing": "组件库没有 HTML 组件代码块。"
  ,"themeLab.issue.forbiddenElement": "组件 HTML 包含禁止的元素。"
  ,"themeLab.issue.forbiddenAttribute": "组件 HTML 包含禁止的属性或样式。"
  ,"themeLab.issue.whiteSpace": "组件 HTML 不得使用 white-space: pre。"
  ,"themeLab.issue.dashedBorder": "四边虚线框应仅用于居中的媒体占位符。"
  ,"themeLab.issue.leaf": "每个组件文本节点都必须由获准的 leaf span 包裹。"
  ,"themeLab.issue.previewDocument": "主题预览不是有效的完整 HTML 文档。"
  ,"themeLab.issue.previewScript": "主题预览包含脚本。"
  ,"themeLab.issue.previewEvent": "主题预览包含事件处理器。"
  ,"themeLab.issue.previewCount": "轻量预览必须包含 8 到 12 个标记区块。"
  ,"themeLab.issue.previewSequence": "主题预览标记必须按 DOM 顺序连续排列。"
  ,"themeLab.notice.saved": "已保存自定义主题：{name}"
  ,"themeLab.preview.heading": "主题实时预览"
  ,"themeLab.preview.title": "Galley Studio 自定义主题全页预览"
  ,"themeLab.save": "保存主题"
  ,"themeLab.status.cancelled": "主题生成已取消。"
  ,"themeLab.status.drafting": "正在生成轻量预览……{seconds} 秒"
  ,"themeLab.status.finalizing": "正在生成完整主题包……{seconds} 秒"
  ,"themeLab.status.generating": "正在生成主题草稿…"
  ,"themeLab.status.invalid": "草稿存在验证错误，无法保存。"
  ,"themeLab.status.loadingRules": "正在加载完整主题规则……{seconds} 秒"
  ,"themeLab.status.operationFailed": "主题操作失败。"
  ,"themeLab.status.saved": "主题已保存，可供新的技能会话使用。"
  ,"themeLab.status.saving": "正在保存完整主题……{seconds} 秒"
  ,"themeLab.status.valid": "轻量预览已完成。你可以继续修改，或保存并生成完整主题。"
  ,"themeLab.status.validating": "正在校验生成结果……{seconds} 秒"
  ,"themeLab.title": "AI 主题实验室"
  ,"themeLab.you": "你"
  ,"workbench.conflict.copy": "另存副本"
  ,"workbench.conflict.message": "此文章已在 Galley Studio 外部更改，请选择后续操作。"
  ,"workbench.conflict.overwrite": "覆盖外部版本"
  ,"workbench.conflict.reload": "重新加载外部版本"
  ,"workbench.export.configuration": "导出配置"
  ,"workbench.export.copy": "复制富文本"
  ,"workbench.export.empty": "暂无导出配置。"
  ,"workbench.export.file": "导出文件"
  ,"workbench.export.filename": "文件名"
  ,"workbench.export.folder": "输出文件夹"
  ,"workbench.export.invalid": "导出配置无效"
  ,"workbench.export.profile.standardWeb": "标准网页"
  ,"workbench.export.profile.portableInline": "便携内联"
  ,"workbench.export.profile.wechat": "微信编辑器"
  ,"workbench.export.status.copying": "正在复制…"
  ,"workbench.export.status.exporting": "正在导出…"
  ,"workbench.export.status.copied": "已复制：{path}"
  ,"workbench.export.status.exported": "已导出：{path}"
  ,"workbench.export.status.previous": "已为上一文档导出 {path}"
  ,"workbench.export.status.saveFailed": "配置保存失败"
  ,"workbench.export.status.recordedAfterCancellation": "已导出 {path}；取消前记录已提交"
  ,"workbench.export.status.recordNotRecorded": "已导出 {path}；侧车记录未写入"
  ,"workbench.export.status.recordAmbiguous": "已导出 {path}；侧车记录结果不明确"
  ,"workbench.export.status.artifactAmbiguous": "{path} 的导出结果不明确"
  ,"workbench.export.status.copyFailedAfterExport": "已导出 {path}；复制失败"
  ,"workbench.export.status.copyFailed": "复制失败"
  ,"workbench.export.status.exportFailed": "导出失败"
  ,"workbench.export.name": "名称"
  ,"workbench.export.profile": "类型"
  ,"workbench.export.save": "保存配置"
  ,"workbench.export.saved": "已保存配置"
  ,"workbench.history.empty": "暂无已保存版本。"
  ,"workbench.history.title": "历史"
  ,"workbench.mode.preview": "预览"
  ,"workbench.mode.source": "源码"
  ,"workbench.mode.visual": "编辑"
  ,"workbench.copyWechat": "复制到公众号"
  ,"workbench.copyWechat.success": "已复制公众号兼容富文本。"
  ,"workbench.copyWechat.failed": "无法复制公众号兼容富文本：{reason}"
  ,"workbench.copySource": "复制源码"
  ,"workbench.copySource.success": "已复制完整 HTML 源码。"
  ,"workbench.copySource.failed": "无法复制 HTML 源码。"
  ,"workbench.source.format": "格式化 HTML"
  ,"workbench.source.language": "HTML 源码"
  ,"workbench.outline.title": "大纲"
  ,"workbench.properties.componentRole": "组件角色"
  ,"workbench.properties.paragraph": "段落"
  ,"workbench.properties.spacing": "段落间距"
  ,"workbench.properties.title": "属性"
  ,"workbench.properties.backgroundColor": "背景色"
  ,"workbench.properties.alignment.left": "左对齐"
  ,"workbench.properties.alignment.center": "居中"
  ,"workbench.properties.alignment.right": "右对齐"
  ,"workbench.properties.alignment.justify": "两端对齐"
  ,"workbench.properties.imageAlt": "图片替代文本"
  ,"workbench.properties.imageCaption": "图片说明"
  ,"workbench.properties.linkUrl": "链接地址"
  ,"workbench.properties.linkTitle": "链接标题"
  ,"workbench.properties.row": "行"
  ,"workbench.properties.column": "列"
  ,"workbench.properties.tableAction": "{action}{dimension}"
  ,"workbench.properties.textColor": "文字颜色"
  ,"workbench.save": "保存"
  ,"workbench.sourceChanged": "源文件已更改"
  ,"workbench.status.conflict": "冲突"
  ,"workbench.status.saved": "已保存"
  ,"workbench.status.saving": "保存中…"
  ,"workbench.status.unsaved": "未保存"
  ,"workbench.title": "Galley Studio 工作台"
  ,"workbench.warning.recovery": "恢复操作需要处理。"
  ,"workbench.error.openAmbiguous": "上次事务结果不明确，未打开任何不完整文档。"
  ,"workbench.error.openQuarantined": "此文档的恢复已隔离，未更改任何文件。"
  ,"workbench.error.recoveryAmbiguous": "上次事务结果不明确，恢复完成前暂停保存。"
  ,"workbench.error.editorInit": "Galley Studio 无法初始化此编辑模式。"
  ,"workbench.error.invalidEdit": "Galley Studio 拒绝了不安全或无效的正文编辑。"
  ,"workbench.error.saveQuarantined": "此文档的恢复已隔离，未覆盖任何文件。"
  ,"workbench.error.saveAmbiguous": "Galley Studio 无法确认保存结果；恢复完成前不能再次保存。"
  ,"workbench.error.saveFailed": "Galley Studio 无法保存此文章。"
  ,"workbench.confirm.reload": "放弃本地编辑并重新加载外部文件？"
  ,"workbench.confirm.overwrite": "使用本地 Galley Studio 编辑覆盖外部文件？"
  ,"workbench.workflow": "生成 → 编辑 → 导出"
  ,"diagnostic.title": "Agent 可用性检查"
  ,"diagnostic.status": "模型调用"
  ,"diagnostic.passed": "可用"
  ,"diagnostic.failed": "不可用"
  ,"diagnostic.model": "Agent / 模型"
  ,"diagnostic.errorCode": "错误代码"
  ,"diagnostic.notice.passed": "Galley Studio Agent 可正常调用大模型。"
  ,"diagnostic.notice.failed": "Galley Studio Agent 不可用（{code}）。"
};

export const RESOURCES = {
  en: EN,
  "zh-CN": ZH_CN
} as const;
