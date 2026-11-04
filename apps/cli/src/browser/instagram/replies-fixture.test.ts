import { expect, test } from 'vitest';
import { Script } from 'node:vm';
import {
  instagramFixture,
  IG_FIXTURE,
} from '../../../e2e/fake-instagram/fixture.ts';
import { postPage } from '../../../e2e/fake-instagram/pages.ts';
import { addRepliesPage } from '../../../e2e/fake-instagram/replies-page.ts';
import {
  rowShapePage,
  replyShapePage,
} from '../../../e2e/fake-instagram/realshape-page.ts';
import { listPage } from '../../../e2e/fake-instagram/pages.ts';

test('realshape generated page mutations produce malformed rows and absent or sibling focal times without real content', async () => {
  const fixture = await instagramFixture(1),
    item = fixture.items[0]!;
  for (const shape of ['extra-line', 'german-age', 'unknown-age'] as const) {
    const source = rowShapePage(listPage([item], 'success', 0), shape);
    expect(source).toContain('#list>[role=button]{white-space:pre-line}');
    expect(source).toContain("node.setAttribute('role','button')");
    expect(source).toContain('list.append(node)');
    expect(source).not.toBe(listPage([item], 'success', 0));
    expect(source).toContain(
      shape === 'german-age'
        ? '2 Std.'
        : shape === 'unknown-age'
          ? '3mo'
          : '2d\\n3 likes',
    );
    const script = source.match(/<script>([\s\S]*)<\/script>/u)![1]!;
    expect(() => new Script(script)).not.toThrow();
  }
  const html = postPage(item, 0, 'success');
  for (const shape of ['time-absent', 'time-nested', 'root-changed'] as const) {
    const source = replyShapePage(html, IG_FIXTURE.commentId, shape);
    expect(source).not.toBe(html);
    if (shape !== 'root-changed')
      expect(source).toContain(
        `/c/${IG_FIXTURE.commentId}/">1w</a>${shape === 'time-nested' ? '<time' : ''}`,
      );
    else {
      const stack: { name: string; position: number }[] = [];
      let focalParent = -1,
        plantedParent = -2;
      for (const token of source
        .slice(0, source.indexOf('<script>'))
        .matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/giu)) {
        const [tag, name] = token;
        if (tag.startsWith('</')) {
          const index = stack.findLastIndex((node) => node.name === name);
          if (index >= 0) stack.splice(index);
          continue;
        }
        if (tag.includes(`/c/${IG_FIXTURE.commentId}/`))
          focalParent = stack.at(-6)?.position ?? -1;
        if (tag.includes('data-generated-root-extra'))
          plantedParent = stack.at(-1)?.position ?? -2;
        if (!['img', 'meta', 'link', 'input', 'br', 'hr'].includes(name!))
          stack.push({ name: name!, position: token.index });
      }
      expect(plantedParent).toBeGreaterThan(0);
      expect(plantedParent).toBe(focalParent);
    }
  }
});

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
  expect(html).toContain('<aside data-reply-decoy>');
});
