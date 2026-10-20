import type { CriteriaModel, KeepRuleModel } from '../../criteria/types.ts';
import type {
  FeedCardModel,
  FeedCounts,
  FeedTab,
  MarkPreviewModel,
} from '../types.ts';

// Invented design material. This module is reachable only from the sheet entry.
export const SHEET_SENTINEL = 'W_FEED_ATELIER_ONLY_20261020';
export type SheetLocale = 'de' | 'en';
export const counts: FeedCounts = {
  suggested: 3812,
  held: 412,
  kept: 57,
  unclear: 96,
  marked: 2,
  all: 12400,
};
export function examples(
  locale: SheetLocale,
): Record<FeedTab, FeedCardModel[]> {
  const de = locale === 'de';
  const post: FeedCardModel = {
    id: 'invented-birch-1',
    name: 'Mika',
    handle: 'demo_birch',
    createdAt: '2019-05-03T14:20:00Z',
    text: de
      ? 'Diese endlosen Diskussionen im Stadtrat. Große Versprechen, aber die letzte Bahn fährt noch immer um zehn.'
      : 'These endless council debates. Big promises, but the last train still leaves at ten.',
    mediaCount: 0,
    kind: 'reply',
    replyTo: 'demo_elm',
    likes: 4,
    reposts: 2,
    replyContext: [
      {
        id: 'invented-elm-1',
        name: 'Robin',
        handle: 'demo_elm',
        createdAt: '2019-05-03T14:10:00Z',
        text: de
          ? 'Der neue Fahrplan ist da. Was fehlt euch noch?'
          : 'The new timetable is here. What is still missing?',
        mediaCount: 0,
      },
    ],
    conversationCount: 5,
    suggestions: [
      {
        id: 'suggestion-1',
        category: de ? 'Politisch' : 'Political',
        level: 2,
        source: { kind: 'example' },
        reason: de
          ? 'Der Beitrag kritisiert die Verkehrspolitik und die Versprechen des Stadtrats.'
          : 'The post criticises transport policy and the council’s promises.',
        evidence: de ? 'Große Versprechen' : 'Big promises',
      },
    ],
    heldBy: [],
    decision: 'undecided',
  };
  const quote: FeedCardModel = {
    ...post,
    id: 'invented-birch-2',
    kind: 'quote',
    createdAt: '2019-04-28T09:30:00Z',
    replyContext: undefined,
    replyTo: undefined,
    conversationCount: undefined,
    text: de
      ? 'Mein großes Talent damals: die Präsentation erst in der Nacht davor anfangen. Drei Kaffee später war das plötzlich eine Strategie.'
      : 'My great talent back then: starting the presentation the night before. Three coffees later, it suddenly became a strategy.',
    quote: {
      id: 'invented-maple-1',
      name: 'Alex',
      handle: 'demo_maple',
      createdAt: '2019-04-27T12:00:00Z',
      text: de
        ? 'Was würdet ihr eurem jüngeren Ich sagen?'
        : 'What would you tell your younger self?',
      mediaCount: 0,
    },
    likes: 2,
    reposts: 0,
    mediaCount: 2,
    suggestions: [
      {
        id: 'suggestion-2',
        category: de ? 'Peinlich' : 'Embarrassing',
        level: 1,
        source: { kind: 'example' },
        reason: de
          ? 'Der Beitrag beschreibt eine Arbeitssituation, die du heute anders zeigen möchtest.'
          : 'The post describes a work habit you may prefer not to present today.',
      },
    ],
  };
  const custom: FeedCardModel = {
    ...post,
    id: 'invented-birch-3',
    replyTo: undefined,
    replyContext: undefined,
    conversationCount: undefined,
    kind: 'post',
    likes: null,
    reposts: null,
    createdAt: '2018-11-12T17:20:00Z',
    text: de
      ? 'Noch eine Besprechung über Besprechungen. In meinem alten Büro hätte das einen eigenen Besprechungsraum verdient.'
      : 'Another meeting about meetings. At my old office that would have earned its own meeting room.',
    suggestions: [
      {
        id: 'suggestion-3',
        category: de ? 'Alter Arbeitgeber' : 'Old employer',
        level: 1,
        source: { kind: 'example' },
        ownCriterion: true,
        reason: de
          ? 'Der Witz bezieht sich auf deinen früheren Arbeitsplatz.'
          : 'The joke refers to your former workplace.',
      },
    ],
  };
  const held = {
    ...post,
    id: 'invented-held',
    likes: 14,
    heldBy: [
      {
        id: 'likes-10',
        value: de ? '14 Gefällt mir' : '14 likes',
        rule: de
          ? 'Nie löschen ab 10 Gefällt mir'
          : 'Never delete with 10 likes or more',
      },
    ],
  };
  const unclear: FeedCardModel = {
    ...custom,
    id: 'invented-unclear',
    kind: 'comment',
    replyTo: 'demo_fern',
    contextMissing: true,
    text: de
      ? 'Das haben wir damals wohl alle anders verstanden.'
      : 'I think we all understood that differently back then.',
    suggestions: [
      {
        id: 'suggestion-unclear',
        category: de ? 'Unklar' : 'Unclear',
        level: 0,
        source: { kind: 'example' },
        unclear: true,
        reason: de
          ? 'Ohne den Beitrag ist nicht zu erkennen, worauf sich der Kommentar bezieht.'
          : 'Without the post, it is not clear what this comment refers to.',
      },
    ],
  };
  const kept = {
    ...quote,
    id: 'invented-kept',
    decision: 'keep' as const,
    decidedAt: '2026-10-20T12:00:00Z',
  };
  const marked = {
    ...custom,
    id: 'invented-marked',
    decision: 'delete' as const,
    decidedAt: '2026-10-20T12:00:00Z',
    markedVia: 'final' as const,
  };
  const later = {
    ...unclear,
    id: 'invented-later',
    decision: 'later' as const,
    suggestions: [],
  };
  const deleted = { ...marked, id: 'invented-deleted', deleted: true };
  return {
    suggested: [
      post,
      quote,
      {
        ...post,
        id: 'invented-birch-4',
        replyContext: undefined,
        replyTo: undefined,
        text: de
          ? 'Heute über den neuen Radweg abgestimmt. Endlich Platz für alle, die nicht mit dem Auto fahren.'
          : 'Voted on the new cycle lane today. Finally, space for everyone who does not drive.',
      },
      { ...quote, id: 'invented-birch-5' },
      {
        ...post,
        id: 'invented-birch-6',
        replyContext: undefined,
        replyTo: undefined,
        text: de
          ? 'Im Herbst wird wieder über die Bibliothek abgestimmt. Ich hoffe, die längeren Öffnungszeiten bleiben.'
          : 'The library is up for another vote this autumn. I hope the longer opening hours stay.',
      },
      { ...quote, id: 'invented-birch-7' },
    ],
    held: [held],
    kept: [{ ...kept, heldBy: held.heldBy }],
    unclear: [
      unclear,
      { ...later, heldBy: held.heldBy, suggestions: post.suggestions },
    ],
    marked: [marked, deleted],
    all: [
      post,
      held,
      kept,
      unclear,
      marked,
      { ...marked, id: 'invented-single-mark', markedVia: 'single' },
      deleted,
      later,
    ],
  };
}

export function instagramCard(
  locale: SheetLocale,
  marked = false,
): FeedCardModel {
  return {
    id: 'invented-instagram',
    name: 'Mika',
    handle: 'demo_fern',
    createdAt: '2020-06-12T10:00:00Z',
    text:
      locale === 'de'
        ? 'Die Debatte um den neuen Park könnte ruhig mehr Platz für die Leute aus der Nachbarschaft lassen.'
        : 'The debate about the new park could leave more room for the people who live nearby.',
    kind: 'comment',
    replyTo: 'demo_maple',
    contextMissing: true,
    mediaCount: 0,
    likes: null,
    reposts: null,
    suggestions: [
      {
        id: 'instagram-suggestion',
        category: locale === 'de' ? 'Politisch' : 'Political',
        level: 2,
        source: { kind: 'example' },
        reason:
          locale === 'de'
            ? 'Der Kommentar nimmt Stellung zur öffentlichen Planung des Parks.'
            : 'The comment takes a position on the public planning of the park.',
      },
    ],
    heldBy: [],
    decision: marked ? 'delete' : 'undecided',
    decidedAt: marked ? '2026-10-20T12:00:00Z' : undefined,
    markedVia: marked ? 'final' : undefined,
  };
}

export function criteriaExample(locale: SheetLocale): CriteriaModel {
  const de = locale === 'de';
  const definitions = [
    [
      'racist',
      'Rassistisch',
      'Racist',
      'Macht Menschen wegen Herkunft oder Hautfarbe herab.',
      'Puts people down for their origin or skin colour.',
      612,
    ],
    [
      'misogynistic',
      'Frauenfeindlich',
      'Misogynistic',
      'Macht Frauen herab, weil sie Frauen sind.',
      'Puts women down for being women.',
      248,
    ],
    [
      'group-hostility',
      'Feindselig gegen Gruppen',
      'Hostile to groups',
      'Macht Menschen wegen Religion, Sexualität, Geschlechtsidentität, Behinderung oder Alter herab.',
      'Puts people down for religion, sexuality, gender identity, disability or age.',
      40,
    ],
    [
      'politically-incorrect',
      'Politisch unkorrekt',
      'Politically incorrect',
      'Sprüche über Gruppen, die viele heute herabsetzend finden.',
      'Remarks about groups that many find demeaning today.',
      377,
    ],
    [
      'political',
      'Politisch',
      'Political',
      'Aussagen über Parteien, Regierung oder politische Streitfragen.',
      'Statements about parties, government or political disputes.',
      1904,
    ],
    [
      'toxic',
      'Toxisch',
      'Toxic',
      'Feindselige Sprache ohne Angriff auf eine Person oder Gruppe.',
      'Hostile language not aimed at a person or group.',
      501,
    ],
    [
      'personal-attack',
      'Persönlicher Angriff',
      'Personal attack',
      'Beleidigt eine bestimmte Person.',
      'Insults a particular person.',
      318,
    ],
    [
      'embarrassing',
      'Peinlich',
      'Embarrassing',
      'Zeigt eine Situation, die du heute anders darstellen möchtest.',
      'Shows a situation you may prefer to present differently today.',
      630,
    ],
    [
      'sexual',
      'Sexuell',
      'Sexual',
      'Enthält sexuelle Anspielungen oder Beschreibungen.',
      'Contains sexual references or descriptions.',
      92,
    ],
    [
      'drugs-illegal',
      'Drogen oder Illegales',
      'Drugs or illegal',
      'Beschreibt Drogen oder rechtswidriges Handeln.',
      'Describes drugs or unlawful activity.',
      17,
    ],
    [
      'personal-info',
      'Persönliche Daten',
      'Personal information',
      'Nennt private Kontaktdaten oder Adressen.',
      'Includes private contact details or addresses.',
      44,
    ],
    [
      'no-content',
      'Ohne Inhalt',
      'No content',
      'Enthält keinen verständlichen eigenen Text.',
      'Contains no meaningful text of your own.',
      138,
    ],
  ] as const;
  return {
    options: [
      ...definitions.map(
        ([id, german, english, germanHelp, englishHelp, hits]) => ({
          id,
          label: de ? german : english,
          description: de ? germanHelp : englishHelp,
          selected: id === 'political' || id === 'embarrassing',
          hits,
          unchecked: id === 'political' ? 248 : 0,
        }),
      ),
      {
        id: 'earlier-difficult',
        label: de ? 'Früheres eigenes Thema' : 'Earlier own topic',
        description: de
          ? 'Eine frühere Kategorie aus dieser Durchsicht.'
          : 'An earlier category from this review.',
        selected: false,
        hits: 6,
        unchecked: 0,
        earlier: true,
      },
      {
        id: 'earlier-full',
        label: de ? 'Weitere frühere Kategorie' : 'Another earlier category',
        description: de
          ? 'Dieses Beispiel zeigt die volle Kategorienliste.'
          : 'This example shows a full category list.',
        selected: false,
        hits: 2,
        unchecked: 0,
        earlier: true,
        noRoom: true,
      },
    ],
    level: 0,
    ownLabel: '',
    ownDescription: '',
    suggested: 4224,
    held: 412,
  };
}
export const rulesExample: readonly KeepRuleModel[] = [
  { id: 'top', kind: 'top-tenth', enabled: true, value: '9', held: 412 },
  {
    id: 'likes',
    kind: 'likes',
    enabled: true,
    value: '10',
    held: 380,
    unknown: false,
  },
  {
    id: 'reposts',
    kind: 'reposts',
    enabled: false,
    value: '5',
    held: 0,
    unknown: false,
  },
  { id: 'date', kind: 'date', enabled: false, value: '2024-01-01', held: 0 },
];
export function previewExample(locale: SheetLocale): MarkPreviewModel {
  const de = locale === 'de';
  return {
    account: 'demo_birch',
    count: 3812,
    criteria: de ? 'Politisch, Peinlich' : 'Political, Embarrassing',
    level: de ? 'jeder Treffer' : 'every match',
    held: 412,
    kept: 57,
    unclear: 96,
    sources: [{ name: de ? 'Beispiele' : 'Examples', count: 3812 }],
    sample: examples(locale).suggested,
    state: 'ready',
  };
}
