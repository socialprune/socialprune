import {
  detailAnswer,
  detailPost,
  DETAIL_FIXTURE,
} from '../../src/originals/test/detail.ts';

/** Generated conversation module with the observed show-more cursor shape. */
export function moduleCursorAnswer(
  focalId = DETAIL_FIXTURE.id,
  unknownItem = false,
) {
  const root = detailPost('901');
  const parent = {
    ...detailPost('902'),
    legacy: { ...detailPost('902').legacy, in_reply_to_status_id_str: '901' },
  };
  const focal = {
    ...detailPost(focalId),
    legacy: { ...detailPost(focalId).legacy, in_reply_to_status_id_str: '902' },
    note_tweet: {
      note_tweet_results: { result: { text: DETAIL_FIXTURE.longText } },
    },
  };
  const original = detailAnswer(focal);
  const cursor = unknownItem
    ? {
        __typename: 'GeneratedUnknownModule',
        itemType: 'GeneratedUnknown',
        value: 'Generated secret @private_decoy 12345678901234567890',
      }
    : {
        cursorType: 'ShowMore',
        value: 'generated-cursor-value',
        displayTreatment: { actionText: 'Generated show more' },
      };
  const entries: unknown[] = [
    {
      entryId: 'conversationthread-generated',
      content: {
        items: [
          {
            entryId: 'tweet-901',
            item: { itemContent: { tweet_results: { result: root } } },
          },
          {
            entryId: 'cursor-show-more-generated',
            item: { itemContent: cursor },
          },
          {
            entryId: 'tweet-902',
            item: { itemContent: { tweet_results: { result: parent } } },
          },
        ],
      },
    },
    ...original.data.threaded_conversation_with_injections_v2.instructions[0]!
      .entries,
  ];
  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [{ type: 'TimelineAddEntries', entries }],
      },
    },
  };
}
