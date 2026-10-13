import { expect, test } from 'vitest';
import { extract } from './extract.ts';
import {
  detailAnswer,
  detailPost,
  DETAIL_FIXTURE,
} from '../../../originals/test/detail.ts';

// Generated values in the parent-scoped path layout: direct itemContent plus
// content.items[].item.itemContent, note_tweet flags and core author fields.
test('real-path mixed conversation shape accepts cursors and module items but projects only the focal post and its parent chain', () => {
  const parent = {
      ...detailPost('909'),
      legacy: { ...detailPost('909').legacy, in_reply_to_status_id_str: '908' },
    },
    root = detailPost('908'),
    focal = {
      ...detailPost(),
      legacy: { ...detailPost().legacy, in_reply_to_status_id_str: '909' },
      note_tweet: {
        is_expandable: true,
        note_tweet_results: {
          result: {
            id: 'generated-note',
            text: DETAIL_FIXTURE.longText,
            entity_set: { urls: [], hashtags: [], symbols: [] },
            richtext: { richtext_tags: [] },
          },
        },
      },
    };
  const answer = detailAnswer(focal) as {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: { type: string; entries: unknown[] }[];
      };
    };
  };
  answer.data.threaded_conversation_with_injections_v2.instructions[0]!.entries.unshift(
    {
      entryId: 'cursor-top-generated',
      content: { entryType: 'TimelineTimelineCursor', cursorType: 'Top' },
    },
    {
      entryId: 'conversationthread-generated',
      content: {
        items: [
          {
            entryId: 'generated-root',
            item: { itemContent: { tweet_results: { result: root } } },
          },
          {
            entryId: 'generated-parent',
            item: { itemContent: { tweet_results: { result: parent } } },
          },
          {
            entryId: 'generated-unrelated',
            item: {
              itemContent: { tweet_results: { result: detailPost('907') } },
            },
          },
        ],
      },
    },
  );
  const result = extract(answer, DETAIL_FIXTURE.id, { instruction: null });
  expect(result.kind).toBe('read');
  if (result.kind !== 'read') throw new Error('not read');
  expect(result.post.text).toBe(DETAIL_FIXTURE.longText);
  expect(result.above.map((post) => post.id)).toEqual(['908', '909']);
  expect(JSON.stringify(result)).not.toContain('907');
});
test('a non-expandable note wrapper without text does not label complete legacy text as truncated', () => {
  const focal = {
    ...detailPost(),
    note_tweet: {
      is_expandable: false,
      note_tweet_results: {
        result: { id: 'generated-note', entity_set: {}, richtext: {} },
      },
    },
  };
  expect(
    extract(detailAnswer(focal), DETAIL_FIXTURE.id, { instruction: null }),
  ).toMatchObject({
    kind: 'read',
    post: { text: DETAIL_FIXTURE.text, textCompleteness: 'full' },
  });
});
test('known module result with absent user fields does not block a complete focal projection and makes a referenced chain partial', () => {
  const focal = {
      ...detailPost(),
      legacy: { ...detailPost().legacy, in_reply_to_status_id_str: '909' },
    },
    partial = { ...detailPost('909'), core: { user_results: {} } };
  const answer = detailAnswer(focal) as {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: { type: string; entries: unknown[] }[];
      };
    };
  };
  answer.data.threaded_conversation_with_injections_v2.instructions[0]!.entries.unshift(
    {
      entryId: 'conversation-generated',
      content: {
        items: [
          {
            entryId: 'generated-parent',
            item: { itemContent: { tweet_results: { result: partial } } },
          },
        ],
      },
    },
  );
  expect(
    extract(answer, DETAIL_FIXTURE.id, { instruction: null }),
  ).toMatchObject({ kind: 'read', above: [], chainAbove: 'partial' });
});
test('module fields from the observed path table without rest_id or expanded user stay out of projection rather than rejecting the complete focal answer', () => {
  const focal = {
      ...detailPost(),
      legacy: { ...detailPost().legacy, in_reply_to_status_id_str: '909' },
    },
    module = {
      __typename: 'Tweet',
      core: { user_results: {} },
      legacy: {
        full_text: 'Generated incomplete module',
        in_reply_to_status_id_str: '908',
      },
      note_tweet: {
        is_expandable: true,
        note_tweet_results: {
          result: { id: 'generated-module-note', entity_set: {}, richtext: {} },
        },
      },
    };
  const answer = detailAnswer(focal) as {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: { type: string; entries: unknown[] }[];
      };
    };
  };
  answer.data.threaded_conversation_with_injections_v2.instructions[0]!.entries.unshift(
    {
      entryId: 'conversation-generated',
      content: {
        items: [
          {
            entryId: 'generated-module-entry',
            item: { itemContent: { tweet_results: { result: module } } },
          },
        ],
      },
    },
  );
  const value = extract(answer, DETAIL_FIXTURE.id, { instruction: null });
  expect(value).toMatchObject({
    kind: 'read',
    above: [],
    chainAbove: 'partial',
  });
  expect(JSON.stringify(value)).not.toContain('Generated incomplete module');
});
