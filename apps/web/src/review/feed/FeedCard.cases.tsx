import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import {
  FeedCard,
  EvidenceText,
  avatarInitials,
  replyText,
} from './FeedCard.tsx';
import { FeedTabs, FinalMarkFooter, ReviewFeed } from './ReviewFeed.tsx';
import { catalogs } from '../../i18n/index.ts';
import type { FeedCardModel } from './types.ts';

const card: FeedCardModel = {
  id: 'generated-one',
  name: 'Taylor',
  handle: 'demo_taylor',
  createdAt: '2019-01-01T12:00:00Z',
  text: 'An invented remark about a council vote.',
  kind: 'reply',
  mediaCount: 2,
  likes: null,
  reposts: 0,
  decision: 'undecided',
  heldBy: [],
  suggestions: [
    {
      id: 'hint-one',
      category: 'Political',
      level: 2,
      source: { kind: 'example' },
      reason: 'This invented post discusses a vote.',
      evidence: 'council vote',
    },
  ],
};
const noop = () => undefined;
function render(node: React.ReactNode, locale: 'en' | 'de' = 'en') {
  return renderToStaticMarkup(
    createElement(IntlProvider, {
      locale,
      messages: catalogs[locale],
      children: node,
    }),
  );
}

describe('presentational feed', () => {
  it('compacts only a leading reply mention run without mutating the source', () => {
    const text =
      '@generated_one @generated_two Own words include @inside and a final word.';
    expect(replyText(text, 'generated_one')).toEqual({
      own: 'Own words include @inside and a final word.',
      mentions: '@generated_one @generated_two',
    });
    expect(text).toBe(
      '@generated_one @generated_two Own words include @inside and a final word.',
    );
    expect(replyText(text)).toEqual({ own: text, mentions: '' });
    expect(replyText('@generated_one ', 'generated_one')).toEqual({
      own: '@generated_one ',
      mentions: '',
    });
    expect(replyText('@this_handle_exceeds_the_limit Body', 'named')).toEqual({
      own: '@this_handle_exceeds_the_limit Body',
      mentions: '',
    });
  });
  it('shows source, level, reason, evidence, unknown counts and explicit local mark', () => {
    const html = render(
      <FeedCard card={card} position={3} total={90} onDecision={noop} />,
    );
    expect(html).toContain('aria-posinset="3"');
    expect(html).toContain('aria-setsize="90"');
    expect(html).toContain('<mark>council vote</mark>');
    expect(html).toContain('Medium');
    expect(html).toContain('Example');
    expect(html).toContain('Likes: unknown');
    expect(html).toContain('0 reposts');
    expect(html).toContain('Nothing is deleted on X yet.');
    expect(html).toContain('<kbd>M</kbd>');
    expect(html).not.toContain('<kbd>J</kbd>');
  });
  it('renders replies above the focal post and quotes below it without a client', () => {
    const context = { ...card, id: 'context', text: 'Earlier context' };
    const html = render(
      <FeedCard
        card={{
          ...card,
          replyContext: [context],
          quote: { ...context, id: 'quoted', text: 'Quoted context' },
          conversationCount: 5,
        }}
        position={1}
        total={1}
        onDecision={noop}
        onConversation={noop}
      />,
    );
    expect(html.indexOf('Earlier context')).toBeLessThan(
      html.indexOf('An invented remark'),
    );
    expect(html.indexOf('Quoted context')).toBeGreaterThan(
      html.indexOf('An invented remark'),
    );
    expect(html).toContain('Show whole conversation (5)');
  });
  it('escapes untrusted content and highlights only a verbatim match', () => {
    expect(
      render(
        <EvidenceText text={'<script>alert(1)</script>'} evidence="missing" />,
      ),
    ).toContain('&lt;script&gt;');
    expect(
      render(<EvidenceText text="Original text" evidence="original" />),
    ).not.toContain('<mark>');
  });
  it('names every holding rule and never implies a platform outcome from a mark', () => {
    const html = render(
      <FeedCard
        card={{
          ...card,
          heldBy: [
            { id: 'likes', value: '14 likes', rule: '10 likes or more' },
          ],
          decision: 'delete',
          decidedAt: '2026-10-20T12:00:00Z',
          markedVia: 'final',
        }}
        position={1}
        total={1}
        onDecision={noop}
      />,
    );
    expect(html).toContain('14 likes');
    expect(html).toContain('10 likes or more');
    expect(html).toContain('with the final mark');
    expect(html).not.toContain('Deleted on X');
    expect(html).toContain('Back to undecided');
  });
  it('makes a deleted outcome distinct and removes decision actions', () => {
    const html = render(
      <FeedCard
        card={{ ...card, deleted: true }}
        position={1}
        total={1}
        onDecision={noop}
      />,
    );
    expect(html).toContain('Deleted on X');
    expect(html).not.toContain('<button');
  });
  it('gives six counted tabs one active tab stop', () => {
    const html = render(
      <FeedTabs
        tab="held"
        counts={{
          suggested: 3812,
          held: 412,
          kept: 57,
          unclear: 96,
          marked: 0,
          all: 12400,
        }}
        onTab={noop}
        panelId="panel"
      />,
    );
    expect(html.match(/role="tab"/g)).toHaveLength(6);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('Held back by your rules, 412 entries');
  });
  it('disables a zero final mark and localizes singular counts', () => {
    expect(
      render(<FinalMarkFooter count={0} held={1} onPreview={noop} />),
    ).toContain('disabled=""');
    expect(
      render(<FinalMarkFooter count={1} held={1} onPreview={noop} />, 'de'),
    ).toContain('1 Eintrag zum Löschen vormerken');
  });
  it('does not render cards or an actionable final mark while loading', () => {
    const html = render(
      <ReviewFeed
        account="demo"
        criteria="Political"
        counts={{
          suggested: 1,
          held: 0,
          kept: 0,
          unclear: 0,
          marked: 0,
          all: 1,
        }}
        tab="suggested"
        cards={[card]}
        busy
        onTab={noop}
        onCriteria={noop}
        onCheck={noop}
        onRetry={noop}
        onDecision={noop}
        onPreview={noop}
        onDelete={noop}
      />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('<article');
    expect(html).toContain('disabled=""');
  });
  it('uses display-name initials and falls back only when the name is empty', () => {
    expect(avatarInitials('Mika', 'demo_birch')).toBe('M');
    expect(avatarInitials('Mika Birch', 'demo_birch')).toBe('MB');
    expect(avatarInitials('  ', 'demo_birch')).toBe('D');
    expect(avatarInitials('Éloïse', 'demo')).toBe('É');
  });
  it.each(['undecided', 'keep', 'later'] as const)(
    'keeps the hold reason and explicit override for decision %s',
    (decision) => {
      const html = render(
        <FeedCard
          card={{
            ...card,
            decision,
            heldBy: [{ id: 'rule', value: '14 likes', rule: '10 or more' }],
          }}
          position={1}
          total={1}
          onDecision={noop}
        />,
      );
      expect(html).toContain('Held back: 14 likes');
      expect(html).toContain('Mark anyway');
      expect(html).not.toMatch(/>Mark<\/button>/);
    },
  );
  it('uses the Instagram footer and click list rather than an X action', () => {
    const html = render(
      <FinalMarkFooter
        count={2}
        held={0}
        marked
        platform="instagram"
        onPreview={noop}
      />,
    );
    expect(html).toContain('2 marked entries wait for you on Instagram.');
    expect(html).toContain('Open the click list');
    expect(html).not.toContain('Delete on X');
  });
  it('keeps the first final-mark explanation visible rather than only in screen-reader text', () => {
    const html = render(
      <FinalMarkFooter count={3} held={1} onPreview={noop} />,
    );
    const paragraph = html.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1];
    expect(paragraph).toContain('Only the suggestions you did not keep.');
    expect(paragraph).toContain('Nothing is deleted on X yet.');
  });
  it('shows first-start guidance without an actionable final mark', () => {
    const html = render(
      <ReviewFeed
        account="demo"
        criteria=""
        hasCriteria={false}
        counts={{
          suggested: 0,
          held: 0,
          kept: 0,
          unclear: 0,
          marked: 0,
          all: 1,
        }}
        tab="suggested"
        cards={[]}
        onTab={noop}
        onCriteria={noop}
        onCheck={noop}
        onRetry={noop}
        onDecision={noop}
        onPreview={noop}
        onDelete={noop}
      />,
      'de',
    );
    expect(html).toContain('Wähle zuerst, was weg soll.');
    expect(html).toContain('Kriterien wählen');
    expect(html).not.toContain('<footer');
  });
  it('keeps Q7 a supplied policy and never calls Later undecided', () => {
    const props = {
      account: 'demo',
      criteria: 'Political',
      counts: { suggested: 1, held: 0, kept: 0, unclear: 1, marked: 0, all: 2 },
      tab: 'unclear' as const,
      cards: [{ ...card, decision: 'later' as const }],
      onTab: noop,
      onCriteria: noop,
      onCheck: noop,
      onRetry: noop,
      onDecision: noop,
      onPreview: noop,
      onDelete: noop,
    };
    expect(render(<ReviewFeed {...props} />)).toContain(
      'The final mark leaves them out; mark one with M if it should go.',
    );
    expect(render(<ReviewFeed {...props} laterExcluded={false} />)).toContain(
      'The preview shows whether Later is included',
    );
    expect(catalogs.en['markPreview.unclear']).toContain('stay as they are');
    expect(catalogs.de['markPreview.unclear']).toContain(
      'bleiben, wie sie sind',
    );
  });
});
