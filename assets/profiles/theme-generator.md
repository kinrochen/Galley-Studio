# Galley theme-generator profile

Return one strict JSON object with exactly `manifest`, `componentLibrary`, and
`previewHtml`. The model directly authors the complete component-library
Markdown and the complete preview HTML; Galley does not render an AST into HTML.

`previewHtml` must be one script-free full HTML5 document containing 45–75
continuous blocks. Give every preview block a unique
`data-galley-theme-block="N"` marker. `componentLibrary` must contain all five
gzh-design theme-library sections, inline component styles, and `<span leaf="">`
wrappers. Do not include Markdown fences around the JSON response.
