# Galley Studio

[中文](#中文) · [English](#english)

---

## 中文

Galley Studio 是一个面向 Obsidian 的 AI 文章排版与 HTML 编辑插件。它可以将
Markdown 文章交给 OpenAI-compatible 模型、Codex CLI 或 Claude CLI，
结合内置排版 Skill 生成适合微信公众号等场景的 HTML，并在 Obsidian
中完成预览、可视化编辑、源码编辑和复制导出。

- 作者：**Kinrochen**
- 当前版本：**0.2.2**
- 最低 Obsidian 版本：**1.11.4**
- 许可证：**AGPL-3.0-or-later**
- 项目地址：<https://github.com/kinrochen/Galley-Studio>
- 宣传文章：[Galley Studio：把 Obsidian 里的 Markdown，变成真正可编辑的公众号 HTML](docs/blog/galley-studio-obsidian-ai-publishing-studio.md)
- 支持项目：<https://ifdian.net/a/kinrochen>

### 功能

#### AI 生成

- 从当前 Markdown 文章生成独立 HTML。
- 支持 Obsidian 内配置的 OpenAI-compatible 服务。
- Desktop 端支持调用本地 Codex CLI 或 Claude CLI。
- 使用内置公众号排版 Skill 和主题组件库约束生成结果。
- 自动从模型上下文、Markdown 代码围栏或混合回复中提取可用 HTML。
- 插件内模型与本地 CLI 的单次生成超时统一为 30 分钟。
- 生成对话展示初始提示词、模型轮次、流式输出、阶段状态和具体错误。
- 生成任务可以在后台继续运行，并可从控制台恢复查看。

#### HTML 工作台

- 安装插件后，`.html` 文件会显示在 Obsidian 文件管理器中。
- Desktop 端单击 HTML 文件直接进入 Galley Studio 工作台。
- 在同一个页面切换：
  - **预览**：沙箱化、安全渲染最终 HTML。
  - **编辑**：使用可视化富文本编辑器修改文章。
  - **源码**：使用接近 IDE 体验的 HTML 格式化与语法高亮编辑器。
- 切换其他 HTML 文件时复用现有工作台页签。
- 支持自动保存、显式保存、复制完整 HTML 和历史恢复。
- 支持普通 `.html` 文件，也兼容 `.galley.html` 文件。

#### 控制台与资源管理

- 控制台：首页、生成对话、文章、主题和设置。
- 管理内置主题和自定义主题。
- 使用固定版本、只读加载的内置公众号排版 Skill。
- 中文、英文和跟随 Obsidian 三种界面语言模式。
- Mobile 端提供文章列表和安全预览，不加载桌面生成及编辑运行时。

### 安装

#### 手动安装

1. 在 Obsidian 仓库中创建目录：

   ```text
   .obsidian/plugins/galley-studio/
   ```

2. 将以下文件复制到该目录：

   ```text
   main.js
   manifest.json
   styles.css
   ```

3. 重新加载 Obsidian。
4. 在“设置 → 第三方插件”中启用 **Galley Studio**。

#### 从源码构建

需要 Node.js 和 npm：

```bash
npm ci
npm run build
```

构建完成后，将根目录中的 `main.js`、`manifest.json` 和 `styles.css`
复制到 `.obsidian/plugins/galley-studio/`。

### 配置生成方式

打开“Galley Studio 设置”并选择生成 Agent。

#### 插件内模型

1. 选择 `Plugin`。
2. 填写 OpenAI-compatible Base URL 和模型名称。
3. 在 Obsidian SecretStorage 中保存 API Key。
4. 在 Galley Studio 中选择对应的 Secret ID。

插件设置只保存 Secret ID，不会把 API Key 写入普通配置文件。

#### 本地 CLI

Desktop 端可以选择：

- `Codex CLI`
- `Claude CLI`

确保对应命令可以从 Obsidian 进程访问，必要时在设置中填写可执行文件路径。

### 基本使用

1. 在 Obsidian 中打开一篇 Markdown 文章。
2. 点击侧边栏报纸图标，或运行命令：

   ```text
   Galley Studio: Open console / 打开控制台
   ```

3. 选择主题并开始生成。
4. 在“生成对话”中查看提示词、模型输出和任务状态。
5. 生成完成后，直接从 Obsidian 文件管理器打开 HTML。
6. 在工作台中切换“预览 / 编辑 / 源码”，保存或复制最终 HTML。

### 项目结构

```text
assets/          内置生成与导出配置
docs/            设计说明和实施记录
src/
  ai/            模型和本地 CLI 客户端
  console/       Galley Studio 控制台
  generation/    生成任务、Skill 驱动流程和 HTML 提取
  documents/     HTML 文档会话、保存和恢复
  editor/        可视化编辑器与源码编辑器
  preview/       安全 HTML 预览
  themes/        主题仓库
  workbench/     预览、编辑、源码工作台
tests/           单元、集成、安全和发布测试
tools/           构建、审计和发布脚本
```

### 开发与校验

```bash
npm run dev
npm test
npm run build
npm run audit:licenses
npm run audit:package
npm run audit:static
npm run release
```

`npm run release` 会构建并校验发布包，包括版本、移动端边界、许可证和
敏感信息扫描。

### 安全说明

- 模型生成的 HTML 按不可信内容处理。
- 预览会移除脚本和可执行属性，并使用限制性 CSP 与空沙箱。
- API 凭据保存在 Obsidian SecretStorage。
- 内置 Skill 固定到已审计提交，并以只读文本方式提供给生成流程。
- 自定义主题导入会检查路径穿越、符号链接、加密条目和大小限制。
- 更完整的安全边界请参阅 [SECURITY.md](SECURITY.md)。

### 支持项目

如果 Galley Studio 对你有帮助，可以通过爱发电支持后续开发：

**<https://ifdian.net/a/kinrochen>**

### 许可证与第三方组件

Galley Studio 使用 **GNU Affero General Public License v3.0 or later**。
完整许可证见 [LICENSE](LICENSE)，第三方依赖与内置 Skill 的来源和许可证
见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

## English

Galley Studio is an AI-assisted article formatting and HTML editing plugin for
Obsidian. It sends Markdown articles to an OpenAI-compatible model, Codex CLI,
or Claude CLI, applies the bundled publishing Skill, and produces editable HTML
for WeChat Official Accounts and other publishing workflows. The resulting
document can be previewed, visually edited, source-edited, saved, and copied
without leaving Obsidian.

- Author: **Kinrochen**
- Current version: **0.2.2**
- Minimum Obsidian version: **1.11.4**
- License: **AGPL-3.0-or-later**
- Repository: <https://github.com/kinrochen/Galley-Studio>
- Launch article (Chinese): [Galley Studio: turn Obsidian Markdown into editable publishing HTML](docs/blog/galley-studio-obsidian-ai-publishing-studio.md)
- Support the project: <https://ifdian.net/a/kinrochen>

### Features

#### AI generation

- Generate a standalone HTML document from the active Markdown article.
- Use an OpenAI-compatible provider configured through Obsidian.
- Use a locally authenticated Codex CLI or Claude CLI on Desktop.
- Apply the bundled WeChat formatting Skill and theme component library.
- Extract usable HTML from model commentary, Markdown fences, or mixed output.
- Use one consistent 30-minute timeout for provider and local CLI generation.
- Display the initial prompt, model rounds, streaming output, progress, and
  detailed failures in a chat-style generation view.
- Keep generation running in the background and reopen its current state from
  the console.

#### HTML workbench

- Show `.html` files directly in the Obsidian file explorer after installation.
- Open HTML files in the Galley Studio workbench with a normal file click on Desktop.
- Switch between three modes in the same view:
  - **Preview** renders sanitized HTML in a restricted sandbox.
  - **Edit** provides a visual rich-text editing experience.
  - **Source** provides formatted HTML with IDE-like syntax highlighting.
- Reuse the existing workbench tab when another HTML file is opened.
- Support autosave, explicit save, full-document HTML copy, and history restore.
- Support both ordinary `.html` files and legacy `.galley.html` files.

#### Console and resource management

- Use stable Console, Generation, Articles, Themes, and Settings pages.
- Manage built-in and custom themes.
- Use the pinned, read-only bundled WeChat formatting Skill.
- Use English, Simplified Chinese, or the current Obsidian language.
- On Mobile, browse articles and open safe previews without loading Desktop
  generation or editing runtimes.

### Installation

#### Manual installation

1. Create the following directory inside your Obsidian vault:

   ```text
   .obsidian/plugins/galley-studio/
   ```

2. Copy these files into the directory:

   ```text
   main.js
   manifest.json
   styles.css
   ```

3. Reload Obsidian.
4. Enable **Galley Studio** under **Settings → Community plugins**.

#### Build from source

Node.js and npm are required:

```bash
npm ci
npm run build
```

After the build finishes, copy `main.js`, `manifest.json`, and `styles.css`
from the project root into `.obsidian/plugins/galley-studio/`.

### Configure a generation agent

Open Galley Studio settings and select a generation agent.

#### In-plugin provider

1. Select `Plugin`.
2. Enter an OpenAI-compatible Base URL and model name.
3. Store the API key in Obsidian SecretStorage.
4. Select the corresponding Secret ID in Galley Studio.

Galley Studio persists only the Secret ID. It does not write the raw API key to its
ordinary settings data.

#### Local CLI

Desktop supports:

- `Codex CLI`
- `Claude CLI`

Make sure the selected command is available to the Obsidian process. Configure
an explicit executable path when automatic discovery is not sufficient.

### Basic workflow

1. Open a Markdown article in Obsidian.
2. Select the newspaper ribbon icon or run:

   ```text
   Galley Studio: Open console / 打开控制台
   ```

3. Select a theme and start generation.
4. Monitor the prompt, model output, and task state on the Generation page.
5. Open the generated HTML directly from the Obsidian file explorer.
6. Switch between Preview, Edit, and Source, then save or copy the final HTML.

### Project structure

```text
assets/          Bundled generation and export profiles
docs/            Design notes and implementation records
src/
  ai/            Provider and local CLI clients
  console/       Galley Studio console
  generation/    Tasks, Skill-driven generation, and HTML extraction
  documents/     HTML sessions, persistence, and recovery
  editor/        Visual and source editors
  preview/       Safe HTML preview
  themes/        Theme repositories
  workbench/     Preview, Edit, and Source workbench
tests/           Unit, integration, security, and release tests
tools/           Build, audit, and release scripts
```

### Development and validation

```bash
npm run dev
npm test
npm run build
npm run audit:licenses
npm run audit:package
npm run audit:static
npm run release
```

`npm run release` builds and verifies the release archive, including version
metadata, Mobile boundaries, licenses, and secret scanning.

### Security

- Model-generated HTML is treated as untrusted input.
- Preview removes scripts and executable attributes and uses a restrictive CSP
  inside an empty sandbox.
- API credentials remain in Obsidian SecretStorage.
- The bundled Skill is pinned to an audited commit and exposed to generation as
  read-only text.
- Custom theme imports are checked for traversal, symbolic links, encryption,
  and configured size limits.
- See [SECURITY.md](SECURITY.md) for the complete security model.

### Support

If Galley Studio is useful to you, you can support continued development through
Afdian:

**<https://ifdian.net/a/kinrochen>**

### License and third-party components

Galley Studio is licensed under the **GNU Affero General Public License v3.0 or
later**. See [LICENSE](LICENSE) for the complete license and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled dependency and
Skill attribution.
