import { describe, expect, it } from "vitest";

import { BUNDLED_SKILL } from "../../src/generated/bundledSkill";
import { PINNED_GZH_DESIGN_VERSION } from "../../src/skill/BundledSkillLoader";
import { validateWechatHtml } from "../../src/export/WechatValidator";
import {
  WECHAT_VALIDATOR_PARITY_FIXTURES,
  WECHAT_VALIDATOR_PARITY_PROVENANCE
} from "../fixtures/wechatValidatorParity";

describe("WechatValidator", () => {
  it.each(WECHAT_VALIDATOR_PARITY_FIXTURES)(
    "matches the pinned Skill deterministic error for $name",
    ({ html, code, pinnedPythonError }) => {
      const typescript = validateWechatHtml(html);

      expect(pinnedPythonError).not.toBe("");
      expect(WECHAT_VALIDATOR_PARITY_PROVENANCE.expectedExitCode).toBe(1);
      expect(typescript.valid).toBe(false);
      expect(typescript.issues.map((issue) => issue.code)).toContain(code);
    }
  );

  it("binds recorded Python parity expectations to the embedded pinned Skill", () => {
    expect(WECHAT_VALIDATOR_PARITY_PROVENANCE).toMatchObject({
      skillVersion: PINNED_GZH_DESIGN_VERSION,
      archiveSha256: BUNDLED_SKILL.archiveSha256,
      validatorPath: "scripts/validate_gzh_html.py"
    });
    expect(BUNDLED_SKILL.files).toContain("scripts/validate_gzh_html.py");
  });

  it("rejects a document shell, multiple roots, and partially unwrapped text", () => {
    expect(validateWechatHtml("<!DOCTYPE html><html><body><section><span leaf=\"\">中文</span></section></body></html>").issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "wechat_document_shell" })]));
    expect(validateWechatHtml("<section><span leaf=\"\">一</span></section><section><span leaf=\"\">二</span></section>").issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "wechat_fragment_root" })]));
    expect(validateWechatHtml("<section><span leaf=\"\">已包裹</span><p>遗漏</p></section>").issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "wechat_leaf_text" })]));
  });

  it("rejects executable attributes and non-section nodes outside the root", () => {
    expect(validateWechatHtml(
      '<section><img src="javascript:alert(1)" onerror="alert(1)"><span leaf="">中文</span></section>'
    ).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "wechat_forbidden_attribute" }),
      expect.objectContaining({ code: "wechat_external_dependency" })
    ]));
    expect(validateWechatHtml(
      '<!-- explanation --><section><span leaf="">中文</span></section>'
    ).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "wechat_fragment_root" })
    ]));
  });
});
