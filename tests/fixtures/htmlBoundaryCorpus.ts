export interface HtmlBoundaryCase {
  label: string;
  fragment: string;
}

export const acceptedHtmlDocuments = [
  {
    label: "lowercase shell with ordinary article markup",
    html: "<!doctype html><html><head><title>Article</title></head><body><article><p>Body</p></article></body></html>"
  },
  {
    label: "case-insensitive canonical doctype and shell names",
    html: "<!DOCTYPE HTML><HTML><HEAD><TITLE>Case</TITLE></HEAD><BODY><P>Body</P></BODY></HTML>"
  },
  {
    label: "ASCII whitespace and valid quoted, unquoted, and boolean attributes",
    html: '<!DOCTYPE html>\n<html lang\t=\r"en"><head><meta charset=utf-8></head><body class=story><img src="images/cover.png"/><video controls src="media/clip.mp4"></video></body></html>'
  },
  {
    label: "strict comments and shell-looking quoted attribute values",
    html: '<!DOCTYPE html><!-- before --><html><head><meta name="shell" content="</head><body>"><!-- head --></head><body><p title="</body></html>">safe</p><!-- body --></body></html>'
  },
  {
    label: "entity-encoded title, plain textarea, and ordinary script text",
    html: "<!DOCTYPE html><html><head><title>safe &lt;/head&gt;</title></head><body><textarea>plain text</textarea><script>alert(1)</script><p>safe</p></body></html>"
  },
  {
    label: "ordinary noscript markup in scripting-disabled parsing",
    html: "<!DOCTYPE html><html><head></head><body><noscript><p>fallback</p></noscript><p>body</p></body></html>"
  },
  {
    label: "case-insensitive exact raw-text closing tag",
    html: "<!DOCTYPE html><html><head></head><body><SCRIPT>alert(1)</SCRIPT><p>safe</p></body></html>"
  }
] as const;

export const recoveryDependentFragments: readonly HtmlBoundaryCase[] = [
  {
    label: "bogus declaration with a quoted apparent boundary",
    fragment: '<!foo "><body>HIDDEN</body>" >'
  },
  {
    label: "processing instruction with a quoted apparent boundary",
    fragment: '<?foo "><body>HIDDEN</body>" >'
  },
  {
    label: "malformed comment declaration with a quoted apparent boundary",
    fragment: '<!-foo "><body>HIDDEN</body>" >'
  },
  {
    label: "noncanonical doctype declaration",
    fragment: '<!DOCTYPE svg "><body>HIDDEN</body>" >'
  },
  {
    label: "legacy public doctype declaration",
    fragment: '<!DOCTYPE html PUBLIC "legacy"><body>HIDDEN</body>'
  },
  {
    label: "doctype with repeated whitespace",
    fragment: "<!DOCTYPE  html><body>HIDDEN</body>"
  },
  {
    label: "doctype with trailing whitespace",
    fragment: "<!DOCTYPE html ><body>HIDDEN</body>"
  },
  {
    label: "abrupt empty comment close",
    fragment: "<!--><body>HIDDEN</body>-->"
  },
  {
    label: "abrupt dash comment close",
    fragment: "<!---><body>HIDDEN</body>-->"
  },
  {
    label: "bang comment close",
    fragment: "<!--x--!><body>HIDDEN</body>-->"
  },
  {
    label: "double dash inside comment data",
    fragment: "<!--a--b--><body>HIDDEN</body>"
  },
  {
    label: "nested comment opener",
    fragment: "<!--a<!--b--><body>HIDDEN</body>"
  },
  {
    label: "unterminated comment",
    fragment: "<!-- never closed"
  },
  {
    label: "comment content ending in a dash",
    fragment: "<!--trailing---><body>HIDDEN</body>"
  },
  {
    label: "slash-equals after an attribute name",
    fragment: '<p a/="><body>HIDDEN</body></html>" >'
  },
  {
    label: "whitespace before slash-equals",
    fragment: '<p a /="><body>HIDDEN</body></html>" >'
  },
  {
    label: "multiple slashes before equals",
    fragment: '<p a//="><body>HIDDEN</body></html>" >'
  },
  {
    label: "whitespace-separated multiple slashes",
    fragment: '<p a / / ="><body>HIDDEN</body></html>" >'
  },
  {
    label: "stray slash before an attribute",
    fragment: '<p / title="safe">safe</p>'
  },
  {
    label: "attribute missing a value",
    fragment: "<p title=>safe</p>"
  },
  {
    label: "double quote in an unquoted attribute value",
    fragment: '<p a=x"><body>HIDDEN</body></html>" >'
  },
  {
    label: "single quote in an unquoted attribute value",
    fragment: "<p a=x'><body>HIDDEN</body></html>' >"
  },
  {
    label: "backtick in an unquoted attribute value",
    fragment: "<p a=x`y>safe</p>"
  },
  {
    label: "equals in an unquoted attribute value",
    fragment: "<p a=x=y>safe</p>"
  },
  {
    label: "less-than in an unquoted attribute value",
    fragment: "<p a=x<y>safe</p>"
  },
  {
    label: "attribute adjacent to a quoted value without whitespace",
    fragment: '<p a="x"b="y">safe</p>'
  },
  {
    label: "case-insensitive duplicate attributes",
    fragment: '<p title="first" TITLE="second">safe</p>'
  },
  {
    label: "attributes on an end tag",
    fragment: "<p>safe</p x>"
  },
  {
    label: "slash on an end tag",
    fragment: "<p>safe</p/>"
  },
  {
    label: "NUL control in text",
    fragment: "<p>safe\u0000text</p>"
  },
  {
    label: "C1 control in an attribute",
    fragment: '<p title="safe\u0085text">safe</p>'
  },
  {
    label: "C0 control in text",
    fragment: "<p>safe\u0001text</p>"
  },
  {
    label: "form-feed control in markup",
    fragment: "<p\fclass=story>safe</p>"
  },
  {
    label: "literal ambiguous less-than text",
    fragment: "<p>2 < 3</p>"
  },
  {
    label: "SVG raw-text namespace switch",
    fragment: "<svg><style><body>HIDDEN</body></style></svg>"
  },
  {
    label: "MathML RCDATA namespace switch",
    fragment: "<math><title><body>HIDDEN</body></title></math>"
  },
  {
    label: "mixed-case SVG root",
    fragment: "<SvG><style><body>HIDDEN</body></style></SvG>"
  },
  {
    label: "mixed-case MathML root",
    fragment: "<MaTh><title><body>HIDDEN</body></title></MaTh>"
  },
  {
    label: "colon-bearing tag name",
    fragment: "<svg:svg><style><body>HIDDEN</body></style></svg:svg>"
  },
  {
    label: "namespace declaration attribute",
    fragment: '<p xmlns="urn:example">safe</p>'
  },
  {
    label: "colon-bearing attribute name",
    fragment: '<p xlink:href="safe">safe</p>'
  },
  {
    label: "script internal less-than construct",
    fragment: '<script>const hidden = "<body>HIDDEN</body>";</script>'
  },
  {
    label: "script escaped-comment construct",
    fragment: "<script><!-- ambiguous --></script>"
  },
  {
    label: "script nonmatching end-tag construct",
    fragment: "<script>safe</fake></script>"
  },
  {
    label: "style internal less-than construct",
    fragment: '<style>p::before{content:"<body>HIDDEN</body>"}</style>'
  },
  {
    label: "title internal end-tag construct",
    fragment: "<title>safe </head><body>HIDDEN</body></title>"
  },
  {
    label: "textarea internal start-tag construct",
    fragment: "<textarea><body>HIDDEN</body></textarea>"
  },
  {
    label: "self-closing script start that browsers treat as raw text",
    fragment: "<script/><body>HIDDEN</body></script>"
  },
  {
    label: "attributes on a raw-text end tag",
    fragment: "<script>alert(1)</script x>"
  },
  {
    label: "plaintext content model",
    fragment: "<plaintext><body>HIDDEN</body>"
  }
];

export function wrapBodyFragment(fragment: string): string {
  return `<!DOCTYPE html><html><head></head><body>${fragment}</body></html>`;
}
