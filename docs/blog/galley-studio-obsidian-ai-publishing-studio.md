---
title: "写在 Obsidian，发布到公众号：Galley Studio 把 AI 排版变成一条完整工作流"
description: "Markdown 写完以后，如何让 AI 完成排版，又保留预览、编辑和源码控制权？这是我开发 Galley Studio 的原因。"
author: "Kinrochen"
date: "2026-07-17"
---

# 写在 Obsidian，发布到公众号：Galley Studio 把 AI 排版变成一条完整工作流

我一直觉得，在 Obsidian 里写完一篇文章，只完成了发布工作的一半。

接下来还要选样式、划重点、调整章节、处理公众号兼容，再把内容搬到另一个编辑器里反复预览。文章明明已经在自己的知识库中完成，最后一步却经常变成复制、粘贴和返工。

AI 让排版快了很多，但也带来了新的麻烦：有时它返回一段完整 HTML，有时在代码前后附上大段解释，有时问一遍提示词里已经写明的问题。即使顺利生成，想改一个标题、删一张卡片，仍然要回到浏览器或 IDE。

我想要的其实很简单：

> **Markdown 是原稿，HTML 是可以继续修改的发布成品，而 AI 只是中间的排版助手。三者都应该留在 Obsidian 里。**

这就是我开发 **Galley Studio** 的原因。

它是一款开源的 Obsidian 插件，可以把当前 Markdown 文章交给 AI 排版，生成独立 HTML，并在同一个工作台里完成预览、可视化编辑、源码编辑和保存。

## 一篇文章在 Galley Studio 里怎样完成

假设我刚在 Obsidian 写完一篇文章。

我不需要把正文复制到某个网页，也不需要另外准备 Prompt。打开 Galley Studio 后，插件会读取当前 Markdown，我只要确认生成方式和主题，就可以开始排版。

![Galley Studio 侧边栏控制台中的主题选择和最近文章](./images/galley-studio-console-and-theme-selection.png)

*Galley Studio 以侧边栏方式打开：当前文章、六套内置主题和最近生成的 HTML 都在同一个控制台中。*

主题不是藏在设置里的几个名称。单独的“主题”页面会完整展示每套主题的视觉预览；除了六套内置主题，还可以进入主题实验室创建自己的排版风格。

![Galley Studio 主题库中的六套内置主题](./images/galley-studio-theme-library.png)

*主题库直接展示实际视觉特征，选主题时不必只凭名字猜效果。*

接下来发生的事情都能看见。

“生成对话”会显示插件实际发给 Agent 的初始提示词、当前执行阶段、每一轮模型输出和耗时。读取文章、加载 Skill、生成 HTML、保存文件，不再只是进度条背后的一团黑盒。任务较长时可以关掉控制台，它仍会在后台继续；重新打开后，进度和对话还在。

![Galley Studio 生成对话显示初始提示词、执行阶段和模型输出](./images/galley-studio-generation-conversation.png)

*生成不是一个没有反馈的等待框：提示词、阶段、模型轮次和耗时都可以查看。*

生成完成后，HTML 会作为一个真实文件出现在 Obsidian 文件管理器中。直接单击它，就会打开 Galley Studio 工作台，而不是跳去浏览器。继续打开其他 HTML 时，工作台会复用现有页签，不会越开越多。

![Galley Studio 文章页面列出知识库中的 HTML 成品](./images/galley-studio-article-library.png)

*生成结果回到知识库里，并集中显示在文章页面；点击“编辑”即可复用同一个工作台。*

在工作台中，我可以随时切换三种视图：

- **预览**：查看文章最终呈现效果；
- **编辑**：像普通富文本编辑器一样直接修改文字和结构；
- **源码**：查看经过格式化和语法高亮的 HTML，精确调整标签与样式。

修改可以自动保存，也可以手动保存和恢复历史版本。确认无误后，再复制最终 HTML 用于公众号或其他发布场景。

![Galley Studio 工作台中的可视化 HTML 编辑器](./images/galley-studio-visual-editor.png)

*HTML 不是只能复制走的终点：它仍然可以在 Obsidian 中预览、可视化编辑、查看源码并保存。*

从打开 Markdown 到拿到可修改的 HTML，整个过程没有离开 Obsidian。

## 我不想再做一个“生成后就不管了”的按钮

市面上并不缺少把文字变成 HTML 的工具。Galley Studio 真正想补上的，是生成之后那段经常被忽略的工作。

### 1. AI 的过程应该可见

如果模型答非所问，我希望能知道它到底收到了什么，而不是只能盲目重试。

因此，Galley Studio 把初始提示词、模型轮次、流式输出和失败原因都放进对话界面。错误信息可以直接阅读，空响应也不会被伪装成一条成功消息。

### 2. AI 的结果不必一次完美

排版是审美工作，很难靠一次生成定稿。

Galley Studio 会尝试从解释文字、Markdown 代码围栏和其他混合回复中提取真正的 HTML；拿到结果以后，你仍然可以在可视化编辑和源码编辑之间切换。模型负责完成大部分重复劳动，人保留最后的判断权。

### 3. HTML 应该属于你的知识库

生成的文章不是藏在插件数据库里的一条记录，而是可以在文件管理器中看到、移动、备份和版本管理的 `.html` 文件。

原始 Markdown 和发布 HTML 可以放在一起。即使以后更换模型、更换工具，文件仍然属于你。

## 模型可以换，工作流不用重建

Galley Studio 支持三种生成方式：

- 插件内配置的 OpenAI-compatible 模型服务；
- Desktop 端本机已经登录的 Codex CLI；
- Desktop 端本机已经登录的 Claude CLI。

你可以按自己的模型、成本和隐私需求选择 Agent。无论使用哪一种方式，文章读取、Skill 加载、过程展示、HTML 保存和后续编辑都由同一套工作流承接。

换句话说，Galley Studio 不是把内容锁进某个模型，而是把模型放进你的内容生产流程。

## 关于排版 Skill：必须说明的开源来源

Galley Studio 的公众号排版能力使用并适配了开源项目 [isjiamu/gzh-design-skill](https://github.com/isjiamu/gzh-design-skill)。

这个 Skill 由 **甲木（Jiamu）× 摸鱼小李（Moyu Xiaoli）** 联名共建，整理了公众号排版所需的主题组件、结构规则、关键词标记方式和平台约束。没有这项开源工作，Galley Studio 不会拥有现在的排版基础。

Galley Studio 并不是该 Skill 的原创项目或官方客户端。插件在固定、已审计的上游提交基础上，以只读方式向生成流程提供 Skill 内容，并增加了 Obsidian 文件集成、Agent 调度、生成对话、HTML 提取、文档保存、安全预览以及可视化与源码编辑能力。

两个项目均采用 **GNU AGPL-3.0** 许可证。完整的上游提交、版权与许可证信息保存在项目的 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) 中。

感谢甲木和摸鱼小李把公众号排版经验整理成可复用的开源 Skill。

## 安全不是一句“请放心”

模型生成的 HTML 不应该被默认信任。

Galley Studio 会在预览前移除脚本和可执行属性，并把内容放进限制性 CSP 和沙箱环境中；API Key 通过 Obsidian SecretStorage 保存，普通插件配置只记录 Secret ID；Mobile 端只提供文章浏览和安全预览，不加载桌面端生成与编辑运行时。

这些限制不会让任何软件变得绝对安全，但它们明确了边界：模型负责生成文章，不因此获得执行任意代码或扩大本机权限的机会。

## 它适合谁

如果你符合下面任何一种情况，Galley Studio 可能会有用：

- 长期在 Obsidian 写作，同时需要发布公众号；
- 想让 AI 完成排版，但不愿把最终控制权交给黑盒；
- 需要在所见即所得编辑和 HTML 源码之间来回切换；
- 希望自由选择在线模型、Codex CLI 或 Claude CLI；
- 想把原稿、发布文件和历史版本都留在自己的仓库中。

如果你只需要一次性的海报图片，或者完全不需要 HTML，它可能并不适合。Galley Studio 更关心的是长文章、可编辑产物，以及一条能够反复使用的发布流程。

## 安装与开始使用

你可以从 [GitHub Releases](https://github.com/kinrochen/Galley-Studio/releases) 下载发布文件，将下面三个文件放入 Obsidian 仓库的插件目录：

```text
.obsidian/plugins/galley-studio/
├── main.js
├── manifest.json
└── styles.css
```

重新加载 Obsidian，在“设置 → 第三方插件”中启用 **Galley Studio**。

启用后：

1. 打开一篇 Markdown 文章；
2. 从侧边栏打开 Galley Studio；
3. 在设置中选择生成 Agent；
4. 选择主题并开始生成；
5. 生成完成后，直接从文件管理器打开 HTML，继续预览或编辑。

也可以从源码构建：

```bash
git clone https://github.com/kinrochen/Galley-Studio.git
cd Galley-Studio
npm ci
npm run build
```

## 写在最后

我做 Galley Studio，不是因为 AI 还缺一个输入框，而是因为内容创作者需要一条更完整的路：从自己熟悉的写作环境出发，借助 AI 完成繁琐排版，再把一个真正属于自己的文件带回来。

**写作不离开 Obsidian，生成过程看得见，最终 HTML 改得动。**

这就是 Galley Studio 现在想做好的事情。

- 项目地址：<https://github.com/kinrochen/Galley-Studio>
- 问题与建议：<https://github.com/kinrochen/Galley-Studio/issues>
- 支持开发：<https://ifdian.net/a/kinrochen>

如果它刚好解决了你的问题，欢迎试用、Star，或者告诉我你真实的发布流程。比起再增加十个按钮，我更想知道哪一步仍然让你不得不离开 Obsidian。
