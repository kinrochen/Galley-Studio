import { describe, expect, it } from "vitest";

import { createWechatRepairSkillPackage } from "../../src/export/WechatRepairSkillPackage";

describe("WeChat repair Skill package", () => {
  it("exposes only the bootstrap files and the required WeChat profile", () => {
    const restricted = createWechatRepairSkillPackage({
      id: "gzh-design",
      version: "pinned",
      files: new Map([
        ["SKILL.md", "workflow"],
        ["references/theme-index.md", "themes"],
        ["references/common-components.md", "must not be visible"],
        ["scripts/validate_gzh_html.py", "reference only"]
      ])
    });

    expect([...restricted.files.keys()]).toEqual([
      "SKILL.md",
      "references/theme-index.md",
      "assets/profiles/wechat.md"
    ]);
    expect(restricted.files.get("assets/profiles/wechat.md")).toContain(
      "must never be executed"
    );
    expect(restricted.files.has("scripts/validate_gzh_html.py")).toBe(false);
  });
});
