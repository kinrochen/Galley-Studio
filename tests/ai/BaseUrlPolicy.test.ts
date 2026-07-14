import { expect, it } from "vitest";
import { validateBaseUrl } from "../../src/ai/BaseUrlPolicy";

it.each([
  "https://api.example.com/v1",
  "http://localhost:11434/v1",
  "http://127.0.0.2/v1",
  "http://10.25.0.3/v1",
  "http://172.31.255.254/v1",
  "http://192.168.1.5/v1",
  "http://[::1]:8080/v1"
])("accepts an allowed provider Base URL: %s", (value) => {
  expect(validateBaseUrl(value)).toBe(value);
});

it("removes trailing slashes from an otherwise valid Base URL", () => {
  expect(validateBaseUrl("https://api.example.com/v1///")).toBe(
    "https://api.example.com/v1"
  );
});

it.each([
  "http://api.example.com/v1",
  "http://8.8.8.8/v1",
  "http://172.15.0.1/v1",
  "http://172.32.0.1/v1",
  "http://192.167.1.1/v1",
  "http://[fd00::1]/v1",
  "ftp://localhost/v1",
  "file:///tmp/provider",
  "https://api.example.com/v1?api_key=value",
  "https://api.example.com/v1#fragment"
])("rejects an unsafe provider Base URL: %s", (value) => {
  expect(() => validateBaseUrl(value)).toThrow(/Invalid provider Base URL/);
});

it("rejects embedded credentials without repeating them in the error", () => {
  const unsafe = "https://private-user:private-password@api.example.com/v1";

  let thrown: unknown;
  try {
    validateBaseUrl(unsafe);
  } catch (caught) {
    thrown = caught;
  }

  expect(thrown).toBeInstanceOf(Error);
  expect(String(thrown)).not.toContain("private-user");
  expect(String(thrown)).not.toContain("private-password");
});
