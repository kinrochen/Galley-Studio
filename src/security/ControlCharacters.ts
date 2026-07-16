export function hasAsciiControl(
  value: string,
  allowJsonWhitespace = false
): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      allowJsonWhitespace &&
      (code === 9 || code === 10 || code === 13)
    ) {
      continue;
    }
    if (code <= 31 || (code >= 127 && code <= 159)) return true;
  }
  return false;
}

export function stripAsciiControlAndSpace(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 32 || (code >= 127 && code <= 159)) continue;
    result += character;
  }
  return result;
}

export function hasBidiControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}
