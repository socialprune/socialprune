import { expect, test } from 'vitest';
import { regionCounts } from './list-regions.ts';

test('list region counters partition nested dialog rows before main and count actual distinct parents', () => {
  const tree = {
    nodeId: 1,
    nodeName: 'HTML',
    children: [
      {
        nodeId: 2,
        nodeName: 'MAIN',
        children: [
          {
            nodeId: 3,
            nodeName: 'DIV',
            children: [{ nodeId: 4, nodeName: 'DIV' }],
          },
          {
            nodeId: 5,
            nodeName: 'DIV',
            attributes: ['role', 'dialog'],
            children: [{ nodeId: 6, nodeName: 'DIV' }],
          },
        ],
      },
      {
        nodeId: 7,
        nodeName: 'NAV',
        children: [{ nodeId: 8, nodeName: 'DIV' }],
      },
    ],
  };
  expect(regionCounts(tree, [3, 4, 6, 8])).toEqual({
    main: 2,
    dialog: 1,
    elsewhere: 1,
    distinctParents: 4,
  });
});
