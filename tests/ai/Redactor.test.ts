import { expect, it } from "vitest";
import { REDACTED, redactDiagnostic } from "../../src/ai/Redactor";

it("recursively redacts auth headers, cookies, secrets, and credential query values", () => {
  const secret = "provider-secret-value";
  const input = {
    headers: {
      Authorization: `Bearer ${secret}`,
      cookie: "session=cookie-value",
      Accept: "application/json"
    },
    request: {
      url: `https://api.example/v1?api_key=query-key&token=query-token&safe=yes`,
      notes: [`secret was ${secret}`]
    }
  };

  const result = redactDiagnostic(input, [secret]) as {
    headers: Record<string, string>;
    request: { url: string; notes: string[] };
  };

  expect(result.headers.Authorization).toBe(REDACTED);
  expect(result.headers.cookie).toBe(REDACTED);
  expect(result.headers.Accept).toBe("application/json");
  expect(result.request.url).toContain(`api_key=${REDACTED}`);
  expect(result.request.url).toContain(`token=${REDACTED}`);
  expect(result.request.url).toContain("safe=yes");
  expect(result.request.notes).toEqual([`secret was ${REDACTED}`]);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(input.headers.Authorization).toContain(secret);
});

it("redacts non-enumerable Error fields and nested causes", () => {
  const secret = "error-secret-value";
  const cause = new Error(`upstream rejected ${secret}`);
  const failure = new Error(`request failed for ${secret}`, { cause });

  const result = redactDiagnostic(failure, [secret]);
  const serialized = JSON.stringify(result);

  expect(serialized).toContain(REDACTED);
  expect(serialized).not.toContain(secret);
  expect(result).toMatchObject({
    name: "Error",
    message: `request failed for ${REDACTED}`,
    cause: {
      message: `upstream rejected ${REDACTED}`
    }
  });
});

it("does not treat an empty configured secret as sensitive text", () => {
  expect(redactDiagnostic("ordinary", [""])).toBe("ordinary");
});

it("redacts common provider credential query parameter names", () => {
  const value =
    "https://api.example/v1?client_secret=one&key=two&x-amz-credential=three&x-amz-signature=four&safe=yes";

  const result = redactDiagnostic(value, []);

  expect(result).toBe(
    `https://api.example/v1?client_secret=${REDACTED}&key=${REDACTED}&x-amz-credential=${REDACTED}&x-amz-signature=${REDACTED}&safe=yes`
  );
});
