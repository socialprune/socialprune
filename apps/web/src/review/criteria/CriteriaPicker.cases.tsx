import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { catalogs } from '../../i18n/index.ts';
import { CriteriaPicker } from './CriteriaPicker.tsx';
import { RulesEditor } from './RulesEditor.tsx';
import type { CriteriaModel } from './types.ts';

const noop = () => undefined;
const model: CriteriaModel = {
  options: [
    {
      id: 'generated',
      label: 'Invented criterion',
      description: 'An invented content definition.',
      selected: true,
      hits: 1,
      unchecked: 2,
      custom: true,
    },
  ],
  level: 0,
  ownLabel: '',
  ownDescription: '',
  suggested: 1,
  held: 0,
};
function render(node: React.ReactNode) {
  return renderToStaticMarkup(
    createElement(IntlProvider, {
      locale: 'en',
      messages: catalogs.en,
      children: node,
    }),
  );
}
const handlers = {
  onToggle: noop,
  onLevel: noop,
  onOwnLabel: noop,
  onOwnDescription: noop,
  onAdd: noop,
  onRemove: noop,
  onOfferRule: noop,
};

describe('controlled criteria and rules', () => {
  it('shows unchecked and unmeasured own criteria, label limits and one chosen level', () => {
    const html = render(<CriteriaPicker model={model} {...handlers} />);
    expect(html).toContain('Not checked yet for 2 entries');
    expect(html).toContain('Your own criterion, not measured');
    expect(html).toContain('maxLength="60"');
    expect(html).toContain('maxLength="300"');
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toContain('1 entry for deletion');
    expect(html).toContain('disabled=""');
  });
  it('shows an offered deterministic rule and blocks adding it as content', () => {
    const html = render(
      <CriteriaPicker
        model={{
          ...model,
          ownLabel: '10 likes',
          ownDescription: 'A number',
          limitOffer: '10 likes or more',
        }}
        {...handlers}
      />,
    );
    expect(html).toContain('This sounds like a limit');
    expect(html).toContain('10 likes or more');
    expect(html).toContain('disabled=""');
  });
  it('marks invalid input accessibly and keeps the text', () => {
    const html = render(
      <CriteriaPicker
        model={{
          ...model,
          ownLabel: 'An unfinished criterion',
          ownError: 'Add a description.',
        }}
        {...handlers}
      />,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('An unfinished criterion');
  });
  it('keeps rules local, renders OR explanation and distinguishes unknown numbers', () => {
    const html = render(
      <RulesEditor
        rules={[
          {
            id: 'likes',
            kind: 'likes',
            enabled: true,
            value: '10',
            held: 2,
            unknown: true,
          },
          {
            id: 'date',
            kind: 'date',
            enabled: false,
            value: '2024-01-01',
            held: 0,
          },
        ]}
        onChange={noop}
        onAdd={noop}
        onRemove={noop}
      />,
    );
    expect(html).toContain('No model and no agent reads them');
    expect(html).toContain('Also hold back when the number is unknown');
    expect(html).toContain('One matching rule is enough');
    expect(html).toContain('type="date"');
    expect(html).toContain('disabled=""');
  });
  it('labels earlier categories and a full slot without hiding the category', () => {
    const html = render(
      <CriteriaPicker
        model={{
          ...model,
          options: [
            {
              ...model.options[0]!,
              custom: false,
              earlier: true,
              noRoom: true,
            },
          ],
        }}
        {...handlers}
      />,
    );
    expect(html).toContain('Earlier category');
    expect(html).toContain('No room: remove an earlier category first.');
    expect(html).toContain('Invented criterion');
    expect(html).toContain('type="checkbox" disabled=""');
  });
});
