export class SseDecoder {
  private buffer = "";
  private dataLines: string[] = [];

  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const values: unknown[] = [];

    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) {
        break;
      }

      const rawLine = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.processLine(rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine, values);
    }

    return values;
  }

  finish(): unknown[] {
    const values: unknown[] = [];
    if (this.buffer) {
      const line = this.buffer.endsWith("\r")
        ? this.buffer.slice(0, -1)
        : this.buffer;
      this.buffer = "";
      this.processLine(line, values);
    }
    this.dispatch(values);
    return values;
  }

  private processLine(line: string, values: unknown[]): void {
    if (line === "") {
      this.dispatch(values);
      return;
    }

    if (!line.startsWith("data:")) {
      return;
    }

    const value = line.slice("data:".length);
    this.dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
  }

  private dispatch(values: unknown[]): void {
    if (this.dataLines.length === 0) {
      return;
    }

    const data = this.dataLines.join("\n");
    this.dataLines = [];
    if (data.trim() === "[DONE]") {
      return;
    }

    try {
      values.push(JSON.parse(data) as unknown);
    } catch {
      throw new Error("Invalid SSE data frame.");
    }
  }
}

export function decodeSseLines(input: string): unknown[] {
  const decoder = new SseDecoder();
  return [...decoder.push(input), ...decoder.finish()];
}
