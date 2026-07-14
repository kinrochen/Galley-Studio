const INVALID_BASE_URL = "Invalid provider Base URL.";

export function validateBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(INVALID_BASE_URL);
  }

  if (
    value !== value.trim() ||
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    value.includes("?") ||
    value.includes("#") ||
    (parsed.protocol === "http:" && !isAllowedInsecureHost(parsed.hostname))
  ) {
    throw new Error(INVALID_BASE_URL);
  }

  return value.replace(/\/+$/, "");
}

function isAllowedInsecureHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") {
    return true;
  }

  const parts = host.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some(
      (part) => !Number.isInteger(part) || part < 0 || part > 255
    )
  ) {
    return false;
  }

  const [first, second] = parts as [number, number, number, number];
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}
