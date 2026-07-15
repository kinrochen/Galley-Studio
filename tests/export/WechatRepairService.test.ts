import { describe, expect, it, vi } from "vitest";

import { WechatRepairService } from "../../src/export/WechatRepairService";

describe("WechatRepairService", () => {
  it("loads only the bootstrap Skill files plus wechat profile and repairs for at most two rounds", async () => {
    const ensureFiles = vi.fn(async () => undefined);
    const completeScoped = vi.fn()
      .mockResolvedValueOnce("<section><p>仍未包裹</p></section>")
      .mockResolvedValueOnce('<section><p><span leaf="">已修复</span></p></section>');
    const service = new WechatRepairService(async () => ({ ensureFiles, completeScoped }));

    const result = await service.repair(
      "<section><p>未包裹</p></section>",
      new AbortController().signal
    );

    expect(result.rounds).toBe(2);
    expect(result.html).toContain("已修复");
    expect(ensureFiles).toHaveBeenCalledWith(
      ["SKILL.md", "references/theme-index.md", "assets/profiles/wechat.md"],
      expect.any(AbortSignal)
    );
    expect(completeScoped).toHaveBeenCalledTimes(2);
    expect(completeScoped.mock.calls[0]?.[0]).toContain("currentHtmlLength");
  });

  it("retains the last candidate and propagates cancellation without a third model call", async () => {
    const completeScoped = vi.fn(async () => "not a section");
    const service = new WechatRepairService(async () => ({
      ensureFiles: vi.fn(async () => undefined),
      completeScoped
    }));
    const controller = new AbortController();
    controller.abort();

    await expect(service.repair("<section>中文</section>", controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(completeScoped).not.toHaveBeenCalled();
  });

  it("sanitizes model repair output before accepting its deterministic shape", async () => {
    const service = new WechatRepairService(async () => ({
      ensureFiles: vi.fn(async () => undefined),
      completeScoped: vi.fn(async () =>
        '<section><p><span leaf="">安全文本</span><img src="javascript:alert(1)" onerror="alert(1)"></p></section>'
      )
    }));

    const result = await service.repair(
      "<section><p>未包裹</p></section>",
      new AbortController().signal
    );

    expect(result.html).toContain('<span leaf="">安全文本</span>');
    expect(result.html).not.toMatch(/onerror|javascript:/iu);
  });
});
