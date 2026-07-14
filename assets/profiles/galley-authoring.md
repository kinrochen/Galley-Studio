# Galley Authoring profile

The gzh-design Skill controls theme selection, component use, article structure, numbering, keyword marking, fidelity, and quality. This profile overrides only WeChat-specific output restrictions.

Return one complete HTML5 document with DOCTYPE, html, head, and body. Keep article styles inline. Scripts, event-handler attributes, executable iframes, forms, object, and embed are forbidden. Every top-level rendered source block must carry the exact `data-galley-source` ID supplied before its Markdown block. Give reusable styled blocks a semantic `data-galley-role`; when a block has a distinct editable content container, mark it `data-galley-slot="content"`. Preserve every source block exactly once and in order. Do not return a Markdown code fence or explanatory prose.
