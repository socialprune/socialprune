export class OutcomePace {
  private start: number | null = null;
  private readonly receipts: number[] = [];
  begin(at = performance.now()) {
    this.start = at;
    this.receipts.length = 0;
  }
  record(at = performance.now()) {
    if (this.start !== null) this.receipts.push(at);
  }
  seconds(): number | null {
    return this.start !== null && this.receipts.length >= 20
      ? (this.receipts.at(-1)! - this.start) / this.receipts.length / 1000
      : null;
  }
}
export function estimateMinutes(entries: number, seconds: number): number {
  return Math.ceil((entries * seconds) / 60);
}
