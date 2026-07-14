import { describe, expect, it } from "vitest";

import { DocumentSession } from "../../src/documents/DocumentSession";
import { GalleyDocumentCodec } from "../../src/documents/GalleyDocumentCodec";
import {
  GalleySidecarV1Schema,
  sha256Text
} from "../../src/documents/GalleySidecar";
import {
  makeSessionDeps,
  TEST_COPY_ID,
  TEST_NOW,
  TEST_PATHS,
  type MemoryWorkbenchHooks
} from "../support/workbenchFixtures";

describe("DocumentSession", () => {
  it("opens a valid exact-hash pair, trusts the sidecar source path, and exposes body state", async () => {
    const fixture = await makeSessionDeps();

    const session = await DocumentSession.open(fixture.dependencies);

    expect(session.paths()).toEqual(TEST_PATHS);
    expect(session.html()).toBe(fixture.html);
    expect(session.bodyHtml()).toContain("original");
    expect(session.state()).toEqual({
      dirty: false,
      saving: false,
      conflict: false,
      htmlHash: await sha256Text(fixture.html),
      sourceChanged: false,
      lastSavedAt: null
    });
  });

  it.each([
    ["malformed sidecar", "not json", undefined],
    ["strict sidecar failure", JSON.stringify({ schemaVersion: 1 }), undefined],
    ["hash mismatch", undefined, "<p>externally changed bytes</p>"],
    [
      "invalid shell",
      undefined,
      "<!DOCTYPE html><html><head></head><body>x<body>nested</body></html>"
    ]
  ])("rejects %s without opening partial state", async (_label, sidecar, html) => {
    const fixture = await makeSessionDeps();
    if (sidecar !== undefined) {
      fixture.vault.writeExternally(TEST_PATHS.sidecar, sidecar);
    }
    if (html !== undefined) {
      fixture.vault.writeExternally(TEST_PATHS.html, html);
      if (_label === "invalid shell") {
        fixture.vault.writeExternally(
          TEST_PATHS.sidecar,
          JSON.stringify({ ...fixture.sidecar, htmlHash: await sha256Text(html) })
        );
      }
    }

    await expect(DocumentSession.open(fixture.dependencies)).rejects.toThrow();
  });

  it.each([
    ["/absolute/article.galley.html", TEST_PATHS.sidecar],
    ["notes/../article.galley.html", TEST_PATHS.sidecar],
    [TEST_PATHS.html, "notes/article.json"],
    ["notes/a.galley.html", "notes/b.galley.json"]
  ])("rejects invalid or contradictory pair paths %j and %j", async (htmlPath, sidecarPath) => {
    const fixture = await makeSessionDeps();
    await expect(
      DocumentSession.open({
        ...fixture.dependencies,
        htmlPath,
        sidecarPath
      })
    ).rejects.toThrow(/path|pair/i);
  });

  it("treats a missing source deterministically as changed", async () => {
    const fixture = await makeSessionDeps({ source: null });
    const session = await DocumentSession.open(fixture.dependencies);

    expect(session.state().sourceChanged).toBe(true);
  });

  it("updates only the body and retains the fully sanitized document", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    const before = GalleyDocumentCodec.parse(session.html());

    session.updateBody(
      '<article data-galley-role="story"><p onclick="alert(1)" style="color: #123; position: fixed"><a href="javascript:alert(1)">local</a><script>alert(1)</script></p></article>'
    );

    const after = GalleyDocumentCodec.parse(session.html());
    expect(after.doctype).toBe(before.doctype);
    expect(after.lang).toBe(before.lang);
    expect(after.headHtml).toBe(before.headHtml);
    expect(after.bodyHtml).toContain("local");
    expect(after.bodyHtml).toContain('style="color: #123"');
    expect(after.bodyHtml).not.toMatch(
      /onclick|javascript:|<script|position:\s*fixed/i
    );
    expect(session.state().dirty).toBe(true);
  });

  it.each([
    "</body><body><p>smuggled</p>",
    "<!DOCTYPE html><p>smuggled</p>",
    "<html><head></head><body>smuggled</body></html>",
    "<p>safe</p><svg><script>alert(1)</script></svg>",
    "<style>body{display:none}</style></head><body>smuggled"
  ])("rejects shell or foreign-content smuggling in body input: %s", async (body) => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);

    expect(() => session.updateBody(body)).toThrow();
    expect(session.html()).toBe(fixture.html);
    expect(session.state().dirty).toBe(false);
  });

  it("marks dirty only for an effective sanitized change and supports exact revert", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    const originalBody = session.bodyHtml();

    session.updateBody(`${originalBody}<script>alert(1)</script>`);
    expect(session.state().dirty).toBe(false);
    expect(session.html()).toBe(fixture.html);

    session.updateBody("<article><p>changed</p></article>");
    expect(session.state().dirty).toBe(true);
    session.updateBody(originalBody);
    expect(session.state().dirty).toBe(false);
    expect(session.html()).toBe(fixture.html);
  });

  it("performs a clean save as a no-op without history or pair writes", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);

    await session.save("explicit");

    expect(fixture.vault.replaceCalls).toBe(0);
    expect(fixture.vault.historyCreateCalls).toBe(0);
    expect(session.state().lastSavedAt).toBeNull();
  });

  it.each(["auto", "explicit"] as const)(
    "saves %s changes with exact prior history and a matching strict sidecar",
    async (reason) => {
      const fixture = await makeSessionDeps();
      const session = await DocumentSession.open(fixture.dependencies);
      session.updateBody("<article><p>saved locally</p></article>");
      const expectedHtml = session.html();

      await session.save(reason);

      const savedHtml = fixture.vault.read(TEST_PATHS.html);
      const savedSidecar = GalleySidecarV1Schema.parse(
        JSON.parse(fixture.vault.read(TEST_PATHS.sidecar) ?? "")
      );
      expect(savedHtml).toBe(expectedHtml);
      expect(savedSidecar.htmlHash).toBe(await sha256Text(expectedHtml));
      expect({ ...savedSidecar, htmlHash: fixture.sidecar.htmlHash }).toEqual(
        fixture.sidecar
      );
      expect((await fixture.history.list(fixture.sidecar.documentId)).map(({ html }) => html)).toEqual([
        fixture.html
      ]);
      expect(session.state()).toMatchObject({
        dirty: false,
        conflict: false,
        saving: false,
        htmlHash: await sha256Text(expectedHtml),
        lastSavedAt: TEST_NOW.toISOString()
      });
    }
  );

  it.each(["html", "sidecar", "html ABA", "sidecar ABA"])(
    "blocks autosave after external %s modification, including same-byte identity replacement",
    async (kind) => {
      const fixture = await makeSessionDeps();
      const session = await DocumentSession.open(fixture.dependencies);
      session.updateBody("<article><p>local</p></article>");

      if (kind === "html") {
        await fixture.replaceExternally("<article><p>external</p></article>");
      } else if (kind === "sidecar") {
        fixture.vault.writeExternally(
          TEST_PATHS.sidecar,
          JSON.stringify({ ...fixture.sidecar, model: "externally-changed" })
        );
      } else if (kind === "html ABA") {
        fixture.vault.writeExternally(TEST_PATHS.html, fixture.html);
      } else {
        fixture.vault.writeExternally(
          TEST_PATHS.sidecar,
          fixture.vault.read(TEST_PATHS.sidecar) ?? ""
        );
      }

      await expect(session.save("auto")).rejects.toMatchObject({
        code: "document_conflict"
      });
      expect(session.state()).toMatchObject({
        dirty: true,
        saving: false,
        conflict: true
      });
      expect(fixture.vault.replaceCalls).toBe(0);
    }
  );

  it("turns a race between re-observation and atomic commit into a typed conflict", async () => {
    const hooks: MemoryWorkbenchHooks = {};
    const fixture = await makeSessionDeps({ hooks });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>local</p></article>");
    hooks.beforeReplace = async () => {
      delete hooks.beforeReplace;
      await fixture.replacePairExternally("<article><p>raced</p></article>");
    };

    await expect(session.save("explicit")).rejects.toMatchObject({
      code: "document_conflict"
    });
    expect(fixture.vault.read(TEST_PATHS.html)).toContain("raced");
    expect(session.state()).toMatchObject({ dirty: true, conflict: true });
  });

  it("overwrite snapshots the latest external HTML and replaces it with the local pair", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>local overwrite</p></article>");
    const localHtml = session.html();
    await fixture.replaceExternally("<article><p>latest external</p></article>");
    const externalHtml = fixture.vault.read(TEST_PATHS.html);

    await session.save("overwrite");

    expect(fixture.vault.read(TEST_PATHS.html)).toBe(localHtml);
    expect((await fixture.history.list(fixture.sidecar.documentId)).map(({ html }) => html)).toEqual([
      externalHtml
    ]);
    expect(session.state()).toMatchObject({ dirty: false, conflict: false });
  });

  it("keeps the old matching pair and dirty state after an injected atomic commit failure", async () => {
    const hooks: MemoryWorkbenchHooks = { failReplace: true };
    const fixture = await makeSessionDeps({ hooks });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>local</p></article>");

    await expect(session.save("explicit")).rejects.toThrow(
      "injected atomic pair replacement failure"
    );

    expect(fixture.vault.read(TEST_PATHS.html)).toBe(fixture.html);
    const sidecar = GalleySidecarV1Schema.parse(
      JSON.parse(fixture.vault.read(TEST_PATHS.sidecar) ?? "")
    );
    expect(sidecar.htmlHash).toBe(await sha256Text(fixture.html));
    expect(session.state()).toMatchObject({ dirty: true, saving: false });
  });

  it("fails closed on post-commit verification while leaving a matching new pair", async () => {
    const hooks: MemoryWorkbenchHooks = {};
    const fixture = await makeSessionDeps({ hooks });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>new matching pair</p></article>");
    hooks.beforeReplace = () => {
      hooks.verifyReadOverride = null;
    };

    await expect(session.save("explicit")).rejects.toMatchObject({
      code: "document_commit_verification"
    });

    const html = fixture.vault.read(TEST_PATHS.html) ?? "";
    const sidecar = GalleySidecarV1Schema.parse(
      JSON.parse(fixture.vault.read(TEST_PATHS.sidecar) ?? "")
    );
    expect(sidecar.htmlHash).toBe(await sha256Text(html));
    expect(session.state()).toMatchObject({ dirty: true, saving: false });
  });

  it("reload discards local content only after a valid reread and refreshes source status", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>local unsaved</p></article>");
    await fixture.replacePairExternally("<article><p>external valid</p></article>");
    fixture.vault.writeExternally(fixture.sidecar.sourcePath, "# Changed source\n");
    await expect(session.save("auto")).rejects.toMatchObject({
      code: "document_conflict"
    });

    await session.reload();

    expect(session.bodyHtml()).toContain("external valid");
    expect(session.state()).toMatchObject({
      dirty: false,
      conflict: false,
      sourceChanged: true
    });
  });

  it("does not discard local state when reload validation fails", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>keep local</p></article>");
    const localHtml = session.html();
    fixture.vault.writeExternally(TEST_PATHS.sidecar, "malformed");

    await expect(session.reload()).rejects.toThrow();

    expect(session.html()).toBe(localHtml);
    expect(session.state().dirty).toBe(true);
  });

  it("saveCopy creates a sanitized matching numbered pair with new identity and leaves the session unchanged", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>copy me</p></article>");
    const originalHtml = fixture.vault.read(TEST_PATHS.html);
    const originalSidecar = fixture.vault.read(TEST_PATHS.sidecar);
    const beforeState = session.state();
    const beforeSessionHtml = session.html();

    const copyPaths = await session.saveCopy();

    expect(copyPaths).toEqual({
      html: "notes/article-2.galley.html",
      sidecar: "notes/article-2.galley.json"
    });
    const copyHtml = fixture.vault.read(copyPaths.html) ?? "";
    const copySidecar = GalleySidecarV1Schema.parse(
      JSON.parse(fixture.vault.read(copyPaths.sidecar) ?? "")
    );
    expect(copyHtml).toBe(beforeSessionHtml);
    expect(copySidecar.documentId).toBe(TEST_COPY_ID);
    expect(copySidecar.htmlHash).toBe(await sha256Text(copyHtml));
    expect({ ...copySidecar, documentId: fixture.sidecar.documentId, htmlHash: fixture.sidecar.htmlHash }).toEqual(
      fixture.sidecar
    );
    expect(fixture.vault.read(TEST_PATHS.html)).toBe(originalHtml);
    expect(fixture.vault.read(TEST_PATHS.sidecar)).toBe(originalSidecar);
    expect(session.paths()).toEqual(TEST_PATHS);
    expect(session.html()).toBe(beforeSessionHtml);
    expect(session.state()).toEqual(beforeState);
  });

  it("saveCopy skips one-sided collisions and an atomic race without deleting either file", async () => {
    const hooks: MemoryWorkbenchHooks = {};
    const fixture = await makeSessionDeps({
      hooks,
      initialFiles: { "notes/article-2.galley.json": "existing one-sided file" }
    });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>copy</p></article>");
    hooks.beforeCreatePair = (paths) => {
      if (paths.html === "notes/article-3.galley.html") {
        fixture.vault.writeExternally(paths.html, "raced HTML");
      }
    };

    const copyPaths = await session.saveCopy();

    expect(copyPaths.html).toBe("notes/article-4.galley.html");
    expect(fixture.vault.read("notes/article-2.galley.json")).toBe(
      "existing one-sided file"
    );
    expect(fixture.vault.read("notes/article-3.galley.html")).toBe("raced HTML");
  });

  it("saveCopy leaves no partial pair after atomic creation failure", async () => {
    const fixture = await makeSessionDeps({
      hooks: { failCreatePair: true }
    });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>copy</p></article>");
    const before = fixture.vault.paths();

    await expect(session.saveCopy()).rejects.toThrow(
      "injected atomic pair creation failure"
    );

    expect(fixture.vault.paths()).toEqual(before);
    expect(session.state()).toMatchObject({ dirty: true, saving: false });
  });

  it("saveCopy conditionally cleans its owned pair after verification failure", async () => {
    const hooks: MemoryWorkbenchHooks = {};
    const fixture = await makeSessionDeps({ hooks });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>copy</p></article>");
    hooks.beforeCreatePair = () => {
      hooks.verifyReadOverride = null;
    };

    await expect(session.saveCopy()).rejects.toMatchObject({
      code: "document_commit_verification"
    });

    expect(fixture.vault.paths()).not.toContain("notes/article-2.galley.html");
    expect(fixture.vault.paths()).not.toContain("notes/article-2.galley.json");
    expect(fixture.vault.removePairCalls).toBe(1);
  });

  it("saveCopy preserves an ABA replacement that appears before cleanup", async () => {
    const hooks: MemoryWorkbenchHooks = {};
    const fixture = await makeSessionDeps({ hooks });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>copy</p></article>");
    hooks.beforeCreatePair = () => {
      hooks.verifyReadOverride = null;
    };
    hooks.beforeRemovePair = (ownership) => {
      fixture.vault.writeExternally(ownership.paths.html, "replacement HTML");
      fixture.vault.writeExternally(
        ownership.paths.sidecar,
        "replacement sidecar"
      );
    };

    await expect(session.saveCopy()).rejects.toMatchObject({
      code: "document_commit_verification"
    });

    expect(fixture.vault.read("notes/article-2.galley.html")).toBe(
      "replacement HTML"
    );
    expect(fixture.vault.read("notes/article-2.galley.json")).toBe(
      "replacement sidecar"
    );
  });

  it("saveCopy rejects an unchanged document ID before creating files", async () => {
    const fixture = await makeSessionDeps({
      randomUUID: () => "123e4567-e89b-42d3-a456-426614174000"
    });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>copy</p></article>");

    await expect(session.saveCopy()).rejects.toThrow(/new document id/i);

    expect(fixture.vault.createPairCalls).toBe(0);
    expect(session.state()).toMatchObject({ dirty: true, saving: false });
  });

  it("keeps a newer local revision dirty when editing during an in-flight save", async () => {
    const gate = deferred<void>();
    const fixture = await makeSessionDeps({
      hooks: { beforeReplace: () => gate.promise }
    });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>first local revision</p></article>");
    const firstHtml = session.html();

    const saving = session.save("explicit");
    await Promise.resolve();
    expect(session.state().saving).toBe(true);
    session.updateBody("<article><p>newer local revision</p></article>");
    gate.resolve();
    await saving;

    expect(fixture.vault.read(TEST_PATHS.html)).toBe(firstHtml);
    expect(session.bodyHtml()).toContain("newer local revision");
    expect(session.state()).toMatchObject({
      dirty: true,
      saving: false,
      htmlHash: await sha256Text(firstHtml)
    });
  });

  it("rejects a concurrent save deterministically while the first save completes", async () => {
    const gate = deferred<void>();
    const fixture = await makeSessionDeps({
      hooks: { beforeReplace: () => gate.promise }
    });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>local</p></article>");

    const first = session.save("explicit");
    await Promise.resolve();
    await expect(session.save("auto")).rejects.toMatchObject({
      code: "document_save_in_progress"
    });
    gate.resolve();
    await first;

    expect(fixture.vault.replaceCalls).toBe(1);
    expect(session.state()).toMatchObject({ dirty: false, saving: false });
  });

  it("propagates abort without writing or clearing dirty state", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>local</p></article>");
    const controller = new AbortController();
    controller.abort();

    await expect(session.save("explicit", controller.signal)).rejects.toMatchObject({
      name: "AbortError"
    });

    expect(fixture.vault.replaceCalls).toBe(0);
    expect(fixture.vault.historyCreateCalls).toBe(0);
    expect(session.state()).toMatchObject({ dirty: true, saving: false });
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
