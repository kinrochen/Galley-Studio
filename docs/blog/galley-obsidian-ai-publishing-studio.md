---
title: "Galley：把 Obsidian 里的 Markdown，变成真正可编辑的公众号 HTML"
description: "从 AI 排版生成、过程可视化，到 HTML 预览、可视化编辑与源码编辑，Galley 把内容发布流程带回 Obsidian。"
author: "Kinrochen"
date: "2026-07-16"
---

# Galley：把 Obsidian 里的 Markdown，变成真正可编辑的公众号 HTML

写作工具已经足够多了，但真正麻烦的，往往是写完之后。

一篇文章在 Obsidian 中完成后，还要经历主题选择、章节重排、关键词标记、
样式适配、公众号兼容、复制粘贴和反复预览。AI 可以生成 HTML，却经常把
解释、代码围栏和上下文一起输出；即使拿到了成品，后续修改又要回到浏览器、
在线编辑器或 IDE。

**Galley 想解决的，就是 Markdown 从“写完”到“可以发布”之间的这段路。**

它是一个面向 Obsidian 的开源 AI 排版与 HTML 编辑插件。你可以从当前
Markdown 文章发起生成，在对话页面看到 Galley 实际发送的提示词和模型输出，
然后直接在 Obsidian 文件管理器中打开生成的 HTML，继续预览、可视化编辑或
修改源码。

整个过程不需要离开你的知识库。

> **开源来源说明**
>
> Galley 的公众号排版能力使用并适配了开源项目
> [isjiamu/gzh-design-skill](https://github.com/isjiamu/gzh-design-skill)。
> 该 Skill 由 **甲木（Jiamu）× 摸鱼小李（Moyu Xiaoli）** 联名共建，
> 提供公众号主题组件、排版方法和平台约束。Galley 不是该 Skill 的原创作者，
> 也不是其官方客户端。更完整的来源和许可证说明见本文的“开源致谢”章节。

## 从一篇 Markdown，到一个可继续工作的 HTML

Galley 的核心不是“让 AI 输出一段代码”，而是把生成、查看和修改组织成一个
连续工作流。

### 1. 在 Obsidian 中完成内容

文章仍然使用你熟悉的 Markdown 编写。笔记属性、链接、素材和正文都留在原来的
知识库结构中，不需要为了排版迁移到另一套内容系统。

### 2. 选择生成 Agent

Galley 支持三种生成方式：

- 在插件中配置 OpenAI-compatible 模型服务；
- 使用本机已经登录的 Codex CLI；
- 使用本机已经登录的 Claude CLI。

模型和工具可以替换，文章工作流不需要跟着迁移。插件内模型与本地 CLI 的单次
生成时限统一为 30 分钟，给长文章和复杂主题留下更充足的处理时间。

### 3. 看见 AI 到底收到了什么

生成不是一个只有进度条的黑盒。

Galley 会在“生成对话”中展示：

- 实际发送给 Agent 的初始提示词；
- 当前读取文章、加载 Skill、生成 HTML 和保存文件的阶段；
- 每一轮模型输出及耗时；
- 可滚动查看的流式内容；
- 失败时清晰、可复制的具体错误信息。

即使关闭控制台，任务仍然可以在后台继续。重新打开后，仍能看到当前生成状态。

### 4. 从混合回复中提取真正的 HTML

不同模型的输出习惯并不一致。

有的模型只返回 HTML，有的会包一层 Markdown 代码围栏，还有的会先解释计划、
输出上下文，最后才给出正文。Galley 会从这些混合内容中提取一个可用的 HTML
产物，避免把模型说明文字直接渲染进文章。

### 5. HTML 成为 Obsidian 中的一等文件

安装 Galley 后，`.html` 文件会直接显示在 Obsidian 文件管理器中。

你不必再回到插件控制菜单寻找“打开预览”。在 Desktop 端单击 HTML 文件，
就会进入 Galley 工作台；继续打开其他 HTML 时，也会复用现有工作台页签，
避免页面越开越多。

### 6. 在同一个页面预览、编辑和查看源码

Galley 工作台提供三种模式：

- **预览**：在限制性 CSP 和空沙箱中安全渲染 HTML；
- **编辑**：使用可视化富文本编辑器直接修改内容；
- **源码**：使用格式化和语法高亮的 HTML 编辑器精确调整结构。

你可以自动保存、显式保存、恢复历史版本，也可以复制完整 HTML，用于公众号或
其他发布平台。

这意味着 AI 生成不再是流程的终点，而是一个可以继续人工打磨的初稿。

## 不只是一个“生成按钮”

Galley 还提供了一套围绕文章生产的控制台：

- **控制台**：查看当前文章、最近生成记录和主要操作；
- **生成对话**：查看后台任务和模型可见输出；
- **文章**：管理已生成的 HTML；
- **主题**：管理内置主题、自定义主题和主题实验室；
- **内置 Skill**：固定到已审计提交，以只读方式参与生成，不需要用户导入或启用；
- **设置**：选择生成 Agent、模型、凭据和界面语言。

界面支持中文、英文以及跟随 Obsidian。Mobile 端保留文章浏览和安全预览，
不会加载桌面生成与编辑运行时。

## 为什么要把 HTML 编辑器放进 Obsidian

AI 排版工具通常有两种断点。

第一种是生成完成后只给你一段 HTML。想改一个标题字号、删除一块内容或检查
结构，就得换工具。

第二种是提供在线编辑器，但文章、素材和知识库被拆散在不同位置。

Galley 选择让 HTML 留在仓库中：

- Markdown 是内容源；
- HTML 是可直接查看和继续编辑的发布产物；
- Obsidian 文件管理器负责组织它们；
- Galley 工作台负责预览、编辑和源码处理。

写作、排版和最终修改因此可以在同一个上下文里完成。

## 安全和隐私边界

模型生成的 HTML 始终按不可信内容处理。

- 预览会移除脚本和可执行属性；
- HTML 在限制性 CSP 和空沙箱中渲染；
- API Key 保存在 Obsidian SecretStorage，普通配置只记录 Secret ID；
- Skill 和主题压缩包会检查路径穿越、符号链接、加密条目和大小限制；
- 移动端不会静态加载桌面生成、富文本编辑和 Skill 管理运行时。

Galley 的目标不是让 AI 获得更多权限，而是把模型输出限制在一个可观察、
可保存、可继续编辑的文章工作流中。

## 开源致谢：关于 gzh-design-skill

Galley 使用并适配了
[isjiamu/gzh-design-skill](https://github.com/isjiamu/gzh-design-skill)
的固定版本。

上游项目是一个面向 AI Agent 的微信公众号排版 Skill，可将 Markdown 转换为
适合粘贴到公众号编辑器的内联 HTML。它提供多套精选主题、主题生成方法、组件
规范、公众号平台限制和质量校验思路。

Galley 从该 Skill 获得的是公众号排版领域知识和主题组件基础，并在其上增加：

- Obsidian 插件界面与文件管理器集成；
- OpenAI-compatible、Codex CLI 和 Claude CLI 的生成调度；
- 生成对话、后台任务和错误状态；
- 模型混合回复中的 HTML 提取；
- HTML 文档保存、恢复和历史管理；
- 预览、可视化编辑与源码编辑工作台；
- SecretStorage、沙箱预览和移动端运行时边界。

Galley 分发包中嵌入的是上游固定提交的常规文件，并将其作为只读 Skill 文本提供
给生成运行时；随附脚本不会由 Galley 执行。

上游项目采用 **GNU AGPL-3.0**，版权归
**甲木（Jiamu）× 摸鱼小李（Moyu Xiaoli）** 所有。Galley 保留了相关署名、
固定提交信息和完整许可证文本：

- 上游项目：<https://github.com/isjiamu/gzh-design-skill>
- Galley 第三方声明：
  [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)
- Galley 许可证：[LICENSE](../../LICENSE)

感谢上游作者将公众号排版经验、主题体系和平台约束整理为可复用的开源 Skill。
Galley 的 Obsidian 工作流建立在这项开源工作的基础之上。

## 谁可能会需要 Galley

Galley 比较适合：

- 在 Obsidian 中长期写作，又需要发布公众号的人；
- 希望使用 AI 排版，但不想把最终控制权交给黑盒工具的人；
- 需要在可视化编辑和 HTML 源码之间切换的内容创作者；
- 希望自由选择模型服务或本地 CLI 的用户；
- 想把 Markdown、HTML 和发布记录留在自己仓库中的团队。

如果你只需要一次性生成图片海报，或者完全不需要 HTML，Galley 可能不是最合适
的工具。它更关注长文章、可编辑产物和持续发布流程。

## 安装与开始使用

Galley 当前可以手动安装。

在 Obsidian 仓库中创建：

```text
.obsidian/plugins/galley/
```

复制以下文件：

```text
main.js
manifest.json
styles.css
```

重新加载 Obsidian，并在“设置 → 第三方插件”中启用 Galley。

也可以从源码构建：

```bash
git clone https://github.com/kinrochen/Galley.git
cd Galley
npm ci
npm run build
```

项目地址：

**<https://github.com/kinrochen/Galley>**

## 写在最后

AI 可以帮我们完成排版，但最终发布的内容，仍然需要人来判断和修改。

Galley 希望提供的不是另一个一次性生成器，而是一张连接 Markdown、Agent、
HTML 和 Obsidian 的工作台：生成过程看得见，文件留得住，成品改得动。

如果这个方向对你有帮助，欢迎试用、提交 Issue，或者参与改进。

也可以通过爱发电支持 Galley 的后续开发：

**<https://ifdian.net/a/kinrochen>**
