import { expect, test } from 'vitest';
import {
  instagramFixture,
  IG_FIXTURE,
} from '../../../e2e/fake-instagram/fixture.ts';
import { postPage } from '../../../e2e/fake-instagram/pages.ts';
import { addRepliesPage } from '../../../e2e/fake-instagram/replies-page.ts';

test('REPLIES-1 generated reply control and group belong directly to the focal permalink fifth ancestor', async () => {
  const fixture = await instagramFixture(1);
  const html = addRepliesPage(
    postPage(fixture.items[0]!, 0, 'success'),
    3,
    IG_FIXTURE.commentId,
    IG_FIXTURE.code,
    fixture.items[0]!.createdAt,
  );
  const stack: { name: string; position: number }[] = [];
  let focalAncestor = -1,
    controlParent = -2,
    groupParent = -3;
  for (const token of html
    .slice(0, html.indexOf('<script>'))
    .matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/giu)) {
    const [tag, name] = token;
    if (tag.startsWith('</')) {
      const index = stack.findLastIndex((node) => node.name === name);
      if (index >= 0) stack.splice(index);
      continue;
    }
    if (tag.includes(`/c/${IG_FIXTURE.commentId}/`))
      focalAncestor = stack.at(-5)?.position ?? -1;
    if (
      tag.startsWith('<button') &&
      html
        .slice(token.index + tag.length)
        .startsWith('View replies</button><ul')
    )
      controlParent = stack.at(-1)?.position ?? -2;
    if (tag === '<ul hidden>') groupParent = stack.at(-1)?.position ?? -3;
    if (!['img', 'meta', 'link', 'input', 'br', 'hr'].includes(name!))
      stack.push({ name: name!, position: token.index });
  }
  expect(focalAncestor).toBeGreaterThan(0);
  expect(controlParent).toBe(focalAncestor);
  expect(groupParent).toBe(focalAncestor);
});
