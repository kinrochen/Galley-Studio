export const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "apikey",
  "clientsecret",
  "credential",
  "key",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "password",
  "signature",
  "xamzcredential",
  "xamzsignature"
]);

const QUERY_CREDENTIAL =
  /([?&](?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|x-amz-credential|x-amz-signature|credential|token|authorization|auth|secret|password|signature|sig|key)=)([^&#\s]*)/gi;

export function redactDiagnostic(value: unknown, secrets: readonly string[]): unknown {
  const replacements = secrets
    .filter((secret) => secret.length > 0)
    .flatMap((secret) => [secret, encodeURIComponent(secret)])
    .filter((secret, index, values) => values.indexOf(secret) === index)
    .sort((left, right) => right.length - left.length);
  const seen = new WeakSet<object>();

  const redact = (input: unknown): unknown => {
    if (typeof input === "string") {
      return redactString(input, replacements);
    }
    if (
      input === null ||
      typeof input === "number" ||
      typeof input === "boolean" ||
      typeof input === "undefined"
    ) {
      return input;
    }
    if (typeof input === "bigint" || typeof input === "symbol") {
      return String(input);
    }
    if (typeof input === "function") {
      return `[${input.name || "Function"}]`;
    }

    if (seen.has(input)) {
      return "[Circular]";
    }
    seen.add(input);

    if (Array.isArray(input)) {
      return input.map(redact);
    }
    if (input instanceof Date) {
      return input.toISOString();
    }
    if (input instanceof Error) {
      const result: Record<string, unknown> = {
        name: redactString(input.name, replacements),
        message: redactString(input.message, replacements)
      };
      if (input.stack) {
        result.stack = redactString(input.stack, replacements);
      }
      if (input.cause !== undefined) {
        result.cause = redact(input.cause);
      }
      for (const [key, nested] of Object.entries(input)) {
        if (!(key in result)) {
          result[key] = isSensitiveKey(key) ? REDACTED : redact(nested);
        }
      }
      return result;
    }

    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(input)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redact(nested);
    }
    return result;
  };

  return redact(value);
}

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value.replace(QUERY_CREDENTIAL, `$1${REDACTED}`);
  for (const secret of secrets) {
    redacted = redacted.split(secret).join(REDACTED);
  }
  return redacted;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[^a-z]/g, ""));
}
