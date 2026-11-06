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
import { listProbePage } from '../../../e2e/fake-instagram/list-probe-page.ts';
import { assertRecordedEvents } from '../../../e2e/fake-instagram/recorder.ts';

test('POSTCLICK diagnostic recorder admits only generated container-height or main wheel deltas', () => {
  const events = (y: number) => [
    {
      inputs: [],
      choices: [],
      clicks: [],
      added: [],
      wheels: [{ area: 'list', x: 0, y }],
    },
  ];
  const allowed = [IG_FIXTURE.scroll.delta, IG_FIXTURE.scroll.listClientHeight];
  expect(() => assertRecordedEvents(events(420))).toThrow();
  expect(() => assertRecordedEvents(events(420), allowed)).not.toThrow();
  expect(() => assertRecordedEvents(events(700), allowed)).not.toThrow();
  expect(() => assertRecordedEvents(events(421), allowed)).toThrow();
});

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

test('realfix generated structure independently reproduces 2/2 old wrapper counts without an avatar link', async () => {
  const fixture = await instagramFixture(1);
  const source = replyShapePage(
    addRepliesPage(
      postPage(fixture.items[0]!, 0, 'success'),
      3,
      IG_FIXTURE.commentId,
      IG_FIXTURE.code,
      fixture.items[0]!.createdAt,
    ),
    IG_FIXTURE.commentId,
    'structural',
  );
  type Node = { tag: string; parent?: Node; children: Node[] };
  const stack: Node[] = [];
  let focal: Node | undefined;
  for (const token of source
    .slice(0, source.indexOf('<script>'))
    .matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/giu)) {
    const [tag, name] = token;
    if (tag.startsWith('</')) {
      const index = stack.findLastIndex((node) => node.tag === name);
      if (index >= 0) stack.splice(index);
      continue;
    }
    const node: Node = { tag: name!, parent: stack.at(-1), children: [] };
    node.parent?.children.push(node);
    if (tag.includes(`/c/${IG_FIXTURE.commentId}/`)) focal = node;
    if (!['img', 'meta', 'link', 'input', 'br', 'hr'].includes(name!))
      stack.push(node);
  }
  let root = focal!;
  for (let depth = 0; depth < 5; depth++) root = root.parent!;
  expect(root.parent!.children).toHaveLength(2);
  expect(
    root.parent!.parent!.children.filter((node) => node.tag === 'div'),
  ).toHaveLength(2);
  expect(
    root.parent!.parent!.children.filter((node) => node.tag === 'a'),
  ).toHaveLength(0);
  expect(source).toContain('Generated reply 0 with local text');
});

test('realfix handle-only decoration composes with the generated probes without hiding normal rows', async () => {
  const fixture = await instagramFixture(1);
  const source = rowShapePage(
    listProbePage(fixture.items, 'absent'),
    'handle-only',
  );
  expect(source).toContain(
    "handleOnlyNode.append(document.createTextNode(handle+'\\n18w'))",
  );
  expect(source).toContain('Generated unrelated probe row');
  expect(source).toContain(
    "node.append(document.createTextNode(row.username+' '+row.text",
  );
  const script = source.match(/<script>([\s\S]*)<\/script>/u)![1]!;
  expect(() => new Script(script)).not.toThrow();
});

test('replyempty generated page has no expand control and its first foreign permalink at depth 11', async () => {
  const fixture = await instagramFixture(1);
  const source = replyShapePage(
    postPage(fixture.items[0]!, 0, 'success'),
    IG_FIXTURE.commentId,
    'no-replies',
  );
  type Node = {
    tag: string;
    parent?: Node;
    children: Node[];
    permalink: boolean;
  };
  const stack: Node[] = [];
  let focal: Node | undefined;
  for (const token of source
    .slice(0, source.indexOf('<script>'))
    .matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/giu)) {
    const [tag, name] = token;
    if (tag.startsWith('</')) {
      const index = stack.findLastIndex((node) => node.tag === name);
      if (index >= 0) stack.splice(index);
      continue;
    }
    const node: Node = {
      tag: name!,
      parent: stack.at(-1),
      children: [],
      permalink: name === 'a' && tag.includes('/c/'),
    };
    node.parent?.children.push(node);
    if (tag.includes(`/c/${IG_FIXTURE.commentId}/`)) focal = node;
    if (!['img', 'meta', 'link', 'input', 'br', 'hr'].includes(name!))
      stack.push(node);
  }
  const links = (node: Node): number =>
    Number(node.permalink) +
    node.children.reduce((sum, child) => sum + links(child), 0);
  let ancestor = focal!;
  for (let depth = 1; depth <= 11; depth++) {
    ancestor = ancestor.parent!;
    expect(links(ancestor)).toBe(depth === 11 ? 2 : 1);
  }
  expect(source.slice(0, source.indexOf('<script>'))).not.toContain(
    'View replies',
  );
  // The foreign sibling retains its ordinary Reply action. The focal has none.
  expect(
    source.slice(0, source.indexOf('<script>')).match(/>Reply<\/div>/gu),
  ).toHaveLength(1);
  const probe = listProbePage(fixture.items, 'newest-unsettled');
  expect(probe).toContain(
    "if(sessionStorage.getItem('probe-newest-unsettled')==='true')chosen=[]",
  );
  expect(
    () => new Script(probe.match(/<script>([\s\S]*)<\/script>/u)![1]!),
  ).not.toThrow();
  const noop = listProbePage(fixture.items, 'newest-noop');
  expect(noop).toContain(
    "dialog.querySelectorAll('[role=button]')[1].onclick=()=>{return}",
  );
  expect(noop).toContain(
    "dialog.querySelectorAll('[role=button]')[0].onclick=()=>{oldest=true;",
  );
  expect(
    () => new Script(noop.match(/<script>([\s\S]*)<\/script>/u)![1]!),
  ).not.toThrow();
});
