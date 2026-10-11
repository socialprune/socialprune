import { personFixture } from './person-fixture.ts';

// Literal generated parent IDs are inputs, not results of the link builder.
export function postContextFixture() {
  const data = personFixture();
  data.items[3]!.reference.replyToId = '18446744073709551615';
  data.items[5]!.reference.quotedId = '1234567890123456789012345';
  return data;
}
