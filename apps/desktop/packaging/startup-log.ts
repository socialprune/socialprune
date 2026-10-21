import { StringDecoder } from 'node:string_decoder';

type Line = {
  message: string;
  count: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
};
// Harness only. De-duplicate the message, not its timestamp, before applying
// a distinct-message budget. A raw tail is retained separately for ordering.
export class StartupLog {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';
  private tail = '';
  private bytes = 0;
  private totalLines = 0;
  private distinctBytes = 0;
  private omittedDistinct = 0;
  private readonly lines = new Map<string, Line>();
  private readonly distinctLimit: number;
  private readonly tailLimit: number;
  constructor(distinctLimit = 16_384, tailLimit = 4096) {
    this.distinctLimit = distinctLimit;
    this.tailLimit = tailLimit;
  }
  append(chunk: string | Buffer) {
    this.bytes += Buffer.byteLength(chunk);
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    this.tail = (this.tail + text).slice(-this.tailLimit);
    this.pending += text;
    let newline;
    while ((newline = this.pending.indexOf('\n')) !== -1) {
      this.line(this.pending.slice(0, newline).replace(/\r$/, ''));
      this.pending = this.pending.slice(newline + 1);
    }
  }
  private line(text: string) {
    if (!text) return;
    this.totalLines++;
    const prefix = /^\[(\d+)(?::\d+)?:((?:\d{4}\/)?\d{6}\.\d+):(.*)$/.exec(
      text,
    );
    const timestamp = prefix?.[2] ?? null;
    const message = prefix ? `[${prefix[1]}:${prefix[3]}` : text;
    const current = this.lines.get(message);
    if (current) {
      current.count++;
      current.lastTimestamp = timestamp;
      return;
    }
    const size = Buffer.byteLength(message);
    if (this.distinctBytes + size > this.distinctLimit) {
      this.omittedDistinct++;
      return;
    }
    this.distinctBytes += size;
    this.lines.set(message, {
      message,
      count: 1,
      firstTimestamp: timestamp,
      lastTimestamp: timestamp,
    });
  }
  snapshot() {
    const lines = [...this.lines.values()].map((line) => ({ ...line }));
    if (this.pending)
      lines.push({
        message: this.pending,
        count: 1,
        firstTimestamp: null,
        lastTimestamp: null,
      });
    return {
      bytes: this.bytes,
      totalLines: this.totalLines,
      omittedDistinct: this.omittedDistinct,
      lines,
      tail: this.tail,
    };
  }
}
