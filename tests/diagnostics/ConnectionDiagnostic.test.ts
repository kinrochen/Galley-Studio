import { expect, it, vi } from "vitest";

import type { HttpTransport } from "../../src/ai/AiProtocol";
import { runConnectionDiagnostic } from "../../src/diagnostics/ConnectionDiagnostic";
import { MemorySecretStore } from "../../src/secrets/SecretStore";
import type { GalleySettings } from "../../src/settings/GalleySettings";
import { makeDiagnosticDeps } from "../support/phase1Factories";

const signal = (): AbortSignal => new AbortController().signal;

it("uses one minimal model call without loading or reporting the Skill", async () => {
  const post = vi.fn<HttpTransport["post"]>().mockResolvedValue({
    status: 200,
    json: { choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }] }
  });
  const result = await runConnectionDiagnostic(
    makeDiagnosticDeps({ transport: { post } }),
    signal()
  );

  expect(result).toEqual({
    ok: true,
    model: "diagnostic-model"
  });
  expect(JSON.stringify(result)).not.toContain("super-secret");
  expect(post).toHaveBeenCalledTimes(1);
});

it("returns an allowlisted error code when the configured secret is missing", async () => {
  const post = vi.fn<HttpTransport["post"]>();

  const result = await runConnectionDiagnostic(
    makeDiagnosticDeps({
      secretStore: new MemorySecretStore(new Map()),
      transport: { post }
    }),
    signal()
  );

  expect(result).toMatchObject({
    ok: false,
    model: "diagnostic-model",
    errorCode: "missing_secret"
  });
  expect(post).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("Authorization");
});

it("does not report a connection success when every real probe is rejected", async () => {
  const secret = "super-secret";
  const post = vi.fn<HttpTransport["post"]>().mockResolvedValue({
    status: 401,
    json: {
      error: {
        message: `Authorization rejected for ${secret}`,
        rawRequest: `Bearer ${secret}`
      }
    }
  });

  const result = await runConnectionDiagnostic(
    makeDiagnosticDeps({ transport: { post } }),
    signal()
  );

  expect(result).toMatchObject({
    ok: false,
    errorCode: "http_error"
  });
  expect(post).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain("Authorization");
  expect(JSON.stringify(result)).not.toContain("rawRequest");
});

it("uses one normalized settings snapshot across every awaited request", async () => {
  const scripted = makeDiagnosticDeps();
  const mutableSettings: GalleySettings = {
    ...scripted.settings,
    baseUrl: "https://api-a.example/v1///",
    model: "model-a",
    secretId: "key-a"
  };
  const requests: Array<{
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }> = [];
  const transport: HttpTransport = {
    post: async (url, headers, body, requestSignal) => {
      requests.push({ url, headers: { ...headers }, body: structuredClone(body) });
      if (requests.length === 1) {
        mutableSettings.baseUrl = "https://api-b.example/v1";
        mutableSettings.model = "model-b";
        mutableSettings.secretId = "key-b";
      }
      return scripted.transport.post(url, headers, body, requestSignal);
    }
  };

  const result = await runConnectionDiagnostic(
    {
      settings: mutableSettings,
      secretStore: new MemorySecretStore(
        new Map([
          ["key-a", "secret-a"],
          ["key-b", "secret-b"]
        ])
      ),
      transport
    },
    signal()
  );

  expect(result.ok).toBe(true);
  expect(result.model).toBe("model-a");
  expect(requests).toHaveLength(1);
  expect(requests.map(({ url }) => url)).toEqual([
    "https://api-a.example/v1/chat/completions"
  ]);
  expect(requests.map(({ headers }) => headers.Authorization)).toEqual([
    "Bearer secret-a"
  ]);
  expect(
    requests.map(({ body }) => (body as { model?: unknown }).model)
  ).toEqual(["model-a"]);
});
