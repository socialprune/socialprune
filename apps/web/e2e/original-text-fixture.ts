import type { Original } from '@socialprune/core';

// Generated inputs and explicit oracles, never copied from a platform answer.
export const originalTextInput = {
  prefix: '@generated_reply @generated_other ',
  body: 'Generated 😀 &amp; &lt;b&gt;paper&lt;/b&gt; &amp;lt;',
  decodedBody: 'Generated 😀 & <b>paper</b> &lt;',
  mediaLink: 'https://t.co/generatedMedia',
  quoteLink: 'https://t.co/generatedQuote',
  unrelatedLink: 'https://t.co/generatedOther',
  quotedId: '81020',
  otherEntities: '&quot; &apos; &#39; &#38; &#x3c; &nbsp; &unknown;',
  ownText: 'Generated own <b>paper</b> & literal &amp;lt; &lt;',
} as const;

export function generatedOriginal(changes: Partial<Original> = {}): Original {
  return {
    id: '81001',
    anonymous: { status: 'fetched', at: '2026-10-15T00:00:00.000Z' },
    signedIn: null,
    text: originalTextInput.body,
    authorName: 'Generated author',
    authorHandle: 'generated_author',
    createdAt: '2020-05-02T12:00:00.000Z',
    textSource: 'anonymous',
    textCompleteness: 'unknown',
    media: [],
    quotedId: null,
    parentId: null,
    conversationId: null,
    chainAbove: null,
    raw: null,
    signedInRecord: null,
    ...changes,
  };
}

export function originalTextCases() {
  const input = originalTextInput;
  const text = `${input.prefix}${input.body} ${input.mediaLink}`;
  const range = [
    Array.from(input.prefix).length,
    Array.from(input.prefix + input.body).length,
  ];
  const quoteText = `${input.body} ${input.quoteLink}`;
  return [
    {
      name: 'entities without metadata',
      original: generatedOriginal(),
      expected: input.decodedBody,
      hidden: ['&amp;', '&lt;b&gt;'],
    },
    {
      name: 'mentions and trailing short link without proof',
      original: generatedOriginal({ text }),
      expected: `${input.prefix}${input.decodedBody} ${input.mediaLink}`,
      hidden: [],
    },
    {
      name: 'code-point display range before entity decoding',
      original: generatedOriginal({
        text,
        raw: { text, display_text_range: range },
      }),
      expected: input.decodedBody,
      hidden: [input.prefix, input.mediaLink],
    },
    {
      name: 'exact trailing media entity link',
      original: generatedOriginal({
        text,
        raw: { text, entities: { media: [{ url: input.mediaLink }] } },
      }),
      expected: `${input.prefix}${input.decodedBody}`,
      hidden: [input.mediaLink],
    },
    {
      name: 'exact trailing quote entity link',
      original: generatedOriginal({
        text: quoteText,
        quotedId: input.quotedId,
        raw: {
          text: quoteText,
          entities: {
            urls: [
              {
                url: input.quoteLink,
                expanded_url: `https://x.com/generated/status/${input.quotedId}`,
              },
            ],
          },
        },
      }),
      expected: input.decodedBody,
      hidden: [input.quoteLink],
    },
    {
      name: 'signed-in text never uses anonymous display metadata',
      original: generatedOriginal({
        text,
        textSource: 'signed-in',
        signedIn: {
          status: 'read',
          at: '2026-10-15T01:00:00.000Z',
          runId: 'generated-run',
          attemptId: 'generated-attempt',
          reason: null,
        },
        signedInRecord: { rest_id: '81001', text },
        raw: {
          text,
          display_text_range: range,
          entities: { media: [{ url: input.mediaLink }] },
        },
      }),
      expected: `${input.prefix}${input.decodedBody} ${input.mediaLink}`,
      hidden: [],
    },
    {
      name: 'unavailable original retains its decoded archived text',
      original: generatedOriginal({
        signedIn: {
          status: 'unavailable',
          at: '2026-10-15T01:00:00.000Z',
          runId: 'generated-run',
          attemptId: 'generated-attempt',
          reason: 'Generated unavailable notice',
        },
      }),
      expected: input.decodedBody,
      hidden: ['&amp;', '&lt;b&gt;'],
    },
  ];
}
