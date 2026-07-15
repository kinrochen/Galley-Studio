export interface WechatValidatorParityFixture {
  readonly name: string;
  readonly html: string;
  readonly code: string;
  readonly pinnedPythonError: string;
}

export const WECHAT_VALIDATOR_PARITY_PROVENANCE = Object.freeze({
  skillVersion: "ba1f4175519b481cb3566616c9e5178705067904",
  archiveSha256: "8b8b521997cf4e7c3073a390c1fe0a4af19580835edfb4e024670457e46fdc00",
  validatorPath: "scripts/validate_gzh_html.py",
  expectedExitCode: 1
});

const ROOT = (body: string) => `<section style="display:block"><p><span leaf="">中文</span></p>${body}</section>`;

export const WECHAT_VALIDATOR_PARITY_FIXTURES: readonly WechatValidatorParityFixture[] = [
  { name: "style tag", html: ROOT("<style>p{color:red}</style>"), code: "wechat_forbidden_tag", pinnedPythonError: "<style> 标签会被过滤，样式必须内联" },
  { name: "script tag", html: ROOT("<script>x</script>"), code: "wechat_forbidden_tag", pinnedPythonError: "<script> 标签会被过滤" },
  { name: "div tag", html: ROOT("<div><span leaf=\"\">中文</span></div>"), code: "wechat_forbidden_tag", pinnedPythonError: "<div> 会被改写，请用 <section>" },
  { name: "link tag", html: ROOT("<link rel=\"stylesheet\" href=\"x.css\">"), code: "wechat_external_dependency", pinnedPythonError: "外部 <link>（CSS/字体）会被过滤" },
  { name: "class attribute", html: '<section class="x"><span leaf="">中文</span></section>', code: "wechat_forbidden_attribute", pinnedPythonError: "class 属性会被剥离，请用内联 style" },
  { name: "id attribute", html: '<section id="x"><span leaf="">中文</span></section>', code: "wechat_forbidden_attribute", pinnedPythonError: "id 属性会被剥离" },
  { name: "absolute position", html: ROOT('<p style="position:absolute"><span leaf="">中文</span></p>'), code: "wechat_forbidden_css", pinnedPythonError: "position fixed/absolute/sticky 不被支持" },
  { name: "float", html: ROOT('<p style="float:left"><span leaf="">中文</span></p>'), code: "wechat_forbidden_css", pinnedPythonError: "float 不被支持" },
  { name: "media", html: ROOT('<p style="@media (x)"><span leaf="">中文</span></p>'), code: "wechat_forbidden_css", pinnedPythonError: "@media 媒体查询不被支持" },
  { name: "keyframes", html: ROOT('<p style="@keyframes x"><span leaf="">中文</span></p>'), code: "wechat_forbidden_css", pinnedPythonError: "@keyframes 动画不被支持" },
  { name: "import", html: ROOT('<p style="@import x"><span leaf="">中文</span></p>'), code: "wechat_forbidden_css", pinnedPythonError: "@import 不被支持" },
  { name: "grid", html: ROOT('<p style="display:grid"><span leaf="">中文</span></p>'), code: "wechat_forbidden_css", pinnedPythonError: "display:grid 不被支持，请用 flex" },
  { name: "css variable", html: ROOT('<p style="color:var(--x)"><span leaf="">中文</span></p>'), code: "wechat_forbidden_css", pinnedPythonError: "CSS 变量 var(--x) 不被支持，请写死值" },
  { name: "remote font", html: ROOT('<p style="background:url(https://x/font.woff2)"><span leaf="">中文</span></p>'), code: "wechat_external_dependency", pinnedPythonError: "外部字体不被支持" },
  { name: "no leaf spans", html: "<section><p>中文</p></section>", code: "wechat_leaf_text", pinnedPythonError: "全文没有任何 <span leaf=\"\"> 包裹" }
] as const;
