import type { Page, Request, Response } from 'playwright-core';
import { postAddress } from './selectors.ts';

export interface InstagramDeleteTarget {
  page: Page;
  origin: string;
  account: string;
  postCode: string;
  commentId: string;
  attemptId: string;
  beforeRequest?(): Promise<void>;
}
/** An in-memory, one-shot admission for a request the page itself sends.
 * No request is constructed or replayed here. Unrecognized writes stay blocked. */
export class InstagramDeletePermission {
  private target: InstagramDeleteTarget | undefined;
  private consumed = false;
  private request: Request | undefined;
  private responseSeen = false;
  private receipt:
    | {
        method: string;
        path: string;
        status: number;
        shape: string[];
        accepted: boolean;
      }
    | undefined;
  arm(target: InstagramDeleteTarget): void {
    if (
      this.target ||
      !/^\d{1,40}$/.test(target.commentId) ||
      !target.account ||
      !target.attemptId ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(target.postCode)
    )
      throw new Error('DELETE_PERMISSION_INVALID');
    this.target = target;
    this.consumed = false;
    this.request = undefined;
    this.responseSeen = false;
    this.receipt = undefined;
  }
  disarm(): void {
    this.target = undefined;
    this.request = undefined;
    this.consumed = false;
  }
  admit(request: Request): boolean {
    const target = this.target;
    if (!target || this.consumed || request.method() !== 'POST') return false;
    const url = new URL(request.url());
    if (
      url.origin !== target.origin ||
      url.search ||
      url.hash ||
      request.frame().page() !== target.page ||
      request.frame().parentFrame() !== null
    )
      return false;
    const address = postAddress(
      target.page.url(),
      target.origin,
      target.commentId,
    );
    if (address?.code !== target.postCode) return false;
    // Narrow legacy website path, documented in instagram-web-api's deleteComment
    // (source read 2026-10-25). This is not a claim about today's real page.
    const match =
      /^(?:\/api\/v1)?\/web\/comments\/(\d{1,40})\/delete\/(\d{1,40})\/$/.exec(
        url.pathname,
      );
    if (
      !match ||
      match[2] !== target.commentId ||
      (request.postData()?.length ?? 0) > 65536
    )
      return false;
    const body = new URLSearchParams(request.postData() ?? '');
    if (
      [...body.keys()].some(
        (key) =>
          !['_csrftoken', 'comment_id', 'media_id'].includes(key) ||
          body.getAll(key).length !== 1,
      ) ||
      (body.has('comment_id') && body.get('comment_id') !== target.commentId) ||
      (body.has('media_id') && body.get('media_id') !== match[1])
    )
      return false;
    this.consumed = true;
    this.request = request;
    return true;
  }
  async response(response: Response): Promise<void> {
    if (
      !this.request ||
      this.responseSeen ||
      response.request() !== this.request
    )
      return;
    this.responseSeen = true;
    const bound = this.request;
    const receipt = {
      method: this.request.method(),
      path: new URL(response.url()).pathname,
      status: response.status(),
      shape: [] as string[],
      accepted: false,
    };
    if (
      Number(response.headers()['content-length'] ?? 0) > 65536 ||
      response.status() !== 200
    ) {
      this.receipt = receipt;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let bytes: Buffer;
    try {
      bytes = await Promise.race([
        response.body(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('DELETE_RECEIPT_TIMEOUT')),
            30000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (bytes.length > 65536) {
      this.receipt = receipt;
      return;
    }
    try {
      const body: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        receipt.shape = Object.keys(body)
          .filter((key) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key))
          .sort();
        receipt.accepted =
          Object.keys(body).length === 1 &&
          'status' in body &&
          body.status === 'ok';
      }
    } catch {
      /* Unrecognized bytes remain an ambiguous receipt. */
    }
    if (this.request === bound) this.receipt = receipt;
  }
  async beforeRequest(): Promise<void> {
    if (!this.target || !this.consumed)
      throw new Error('DELETE_PERMISSION_INVALID');
    await this.target.beforeRequest?.();
  }
  result() {
    return this.receipt
      ? { ...this.receipt, shape: [...this.receipt.shape] }
      : undefined;
  }
}
