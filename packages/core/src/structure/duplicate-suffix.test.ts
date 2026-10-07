import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { expect, test } from 'vitest';
import { createMemoryArchive } from '../archive/index.ts';
import { openArchivePaths } from '../node/index.ts';
import { describeStructure } from './index.ts';

// LL-2026-10-002: these forbidden strings and expected paths are literal input
// facts, never extracted by either the production or fixture-sweep pattern.
const FORBIDDEN_IDENTITIES = ['rev_handle', 'zz9q', 'ab12cd'];
const COMMENTS = '{"rev_handle":"Generated duplicate-export content."}';

test.each([
  'instagram-rev_handle-2026-01-02-zz9q (1)',
  'instagram-rev_handle-2026-01-02-zz9q(2)',
  'instagram-rev_handle-2026-01-02-zz9q_3 (42)',
  'instagram-rev_handle-2026-01-02-zz9q_3(4567)',
])(
  'duplicate folder name %s remains an identity source through Node directory access',
  async (name) => {
    const root = await mkdtemp(join(tmpdir(), 'socialprune-duplicate-folder-'));
    const folder = join(root, name);
    try {
      await mkdir(join(folder, 'comments'), { recursive: true });
      await writeFile(join(folder, 'comments/posts.json'), COMMENTS);
      const archive = await openArchivePaths([folder]);
      try {
        // Directory readers carry only the basename, with no ZIP extension.
        expect(archive.archives).toEqual([name]);
        const report = await describeStructure(archive);
        const serialized = JSON.stringify(report).toLowerCase();
        for (const identity of FORBIDDEN_IDENTITIES)
          expect(serialized).not.toContain(identity);
        expect(report.files[0]?.pattern).toBe('comments/posts.json');
        expect(report.files[0]?.paths).toContainEqual({
          path: '$.<key>',
          types: ['string'],
        });
      } finally {
        await archive.close();
      }
      const parent = await openArchivePaths([root]);
      try {
        const report = await describeStructure(parent);
        expect(report.files[0]?.pattern).toBe('<root>/comments/posts.json');
        for (const identity of FORBIDDEN_IDENTITIES)
          expect(JSON.stringify(report).toLowerCase()).not.toContain(identity);
      } finally {
        await parent.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.each([
  'instagram-rev_handle-2026-01-02-zz9q (1).zip',
  'instagram-rev_handle-2026-01-02-zz9q(2).zip',
  'instagram-rev_handle-2026-01-02-zz9q_3 (42).zip',
  'instagram-rev_handle-2026-01-02-zz9q_3(4567).ZIP',
])(
  'duplicate ZIP name %s remains an identity source through Node ZIP access',
  async (name) => {
    const root = await mkdtemp(join(tmpdir(), 'socialprune-duplicate-zip-'));
    try {
      const writer = new ZipWriter(new BlobWriter(), {
        useWebWorkers: false,
        useCompressionStream: true,
      });
      await writer.add('comments/posts.json', new TextReader(COMMENTS));
      const zip = await writer.close();
      const file = join(root, name);
      await writeFile(file, new Uint8Array(await zip.arrayBuffer()));
      const archive = await openArchivePaths([file]);
      try {
        // ZIP readers carry the complete basename, including the extension.
        expect(archive.archives).toEqual([name]);
        const report = await describeStructure(archive);
        for (const identity of FORBIDDEN_IDENTITIES)
          expect(JSON.stringify(report).toLowerCase()).not.toContain(identity);
        expect(report.files[0]?.paths).toContainEqual({
          path: '$.<key>',
          types: ['string'],
        });
      } finally {
        await archive.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.each([
  'instagram-rev_handle-2026-01-02-zz9q (1)',
  'instagram-rev_handle-2026-01-02-zz9q(2)',
  'instagram-rev_handle-2026-01-02-zz9q_3 (42)',
  'instagram-rev_handle-2026-01-02-zz9q_3(4567)',
])(
  'nested duplicate folder %s is masked even when likes is not a known directory',
  async (name) => {
    const archive = createMemoryArchive('generated-parent', {
      [`incoming/nested/${name}/comments/posts.json`]: COMMENTS,
      [`incoming/nested/${name}/likes/liked_posts.json`]: COMMENTS,
      'notes.txt': 'Generated sibling.',
    });
    try {
      const report = await describeStructure(archive);
      for (const identity of FORBIDDEN_IDENTITIES)
        expect(JSON.stringify(report).toLowerCase()).not.toContain(identity);
      expect(report.files.map(({ pattern }) => pattern)).toEqual([
        '<root>/comments/posts.json',
        '<root>/nested/<root>/likes/liked_posts.json',
      ]);
      for (const file of report.files)
        expect(file.paths).toContainEqual({
          path: '$.<key>',
          types: ['string'],
        });
    } finally {
      await archive.close();
    }
  },
);

test.each([
  'twitter-2026-10-01-ab12cd (1).zip',
  'twitter-2026-10-01-ab12cd(2).zip',
])(
  'duplicate X ZIP %s has a parsed minimal export and no identifying wrapper',
  async (name) => {
    const root = await mkdtemp(join(tmpdir(), 'socialprune-duplicate-x-'));
    try {
      const writer = new ZipWriter(new BlobWriter(), {
        useWebWorkers: false,
        useCompressionStream: true,
      });
      const target = ['window', 'YTD', 'tweets', 'part0'].join('.');
      await writer.add(
        'data/tweets.js',
        new TextReader(
          `${target} = [{"tweet":{"id_str":"123","full_text":"Generated minimal X export."}}];`,
        ),
      );
      await writer.add(
        `incoming/nested/${name}/likes/liked_posts.json`,
        new TextReader('{"items":[]}'),
      );
      const file = join(root, name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(
        file,
        new Uint8Array(await (await writer.close()).arrayBuffer()),
      );
      const archive = await openArchivePaths([file]);
      try {
        expect(archive.archives).toEqual([name]);
        const report = await describeStructure(archive);
        for (const identity of FORBIDDEN_IDENTITIES)
          expect(JSON.stringify(report).toLowerCase()).not.toContain(identity);
        expect(report.files.map(({ pattern }) => pattern)).toEqual([
          '<root>/nested/<root>/likes/liked_posts.json',
          'data/tweets.js',
        ]);
        expect(
          report.files.every(
            (entry) => entry.parsed === 1 && entry.unparsed === 0,
          ),
        ).toBe(true);
      } finally {
        await archive.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.each([
  'instagram-rev_handle-2026-01-02-zz9q.zip',
  'instagram-rev_handle-2026-01-02-zz9q_2.zip',
  'twitter-2026-10-01-ab12cd.zip',
])(
  'plain ZIP export %s masks its real reader identity and its raw nested ZIP-named path',
  async (name) => {
    const root = await mkdtemp(join(tmpdir(), 'socialprune-plain-export-zip-'));
    try {
      const writer = new ZipWriter(new BlobWriter(), {
        useWebWorkers: false,
        useCompressionStream: true,
      });
      if (name.startsWith('instagram-')) {
        await writer.add('comments/posts.json', new TextReader(COMMENTS));
      } else {
        const target = ['window', 'YTD', 'tweets', 'part0'].join('.');
        await writer.add(
          'data/tweets.js',
          new TextReader(
            `${target} = [{"tweet":{"full_text":"Generated plain X export."}}];`,
          ),
        );
        await writer.add(
          `incoming/nested/${name}/likes/liked_posts.json`,
          new TextReader('{"items":[]}'),
        );
      }
      const file = join(root, name);
      await writeFile(
        file,
        new Uint8Array(await (await writer.close()).arrayBuffer()),
      );
      const archive = await openArchivePaths([file]);
      try {
        expect(archive.archives).toEqual([name]);
        const report = await describeStructure(archive);
        for (const identity of FORBIDDEN_IDENTITIES)
          expect(JSON.stringify(report).toLowerCase()).not.toContain(identity);
        if (name.startsWith('instagram-'))
          expect(report.files[0]?.paths).toContainEqual({
            path: '$.<key>',
            types: ['string'],
          });
        else
          expect(report.files[0]?.pattern).toBe(
            '<root>/nested/<root>/likes/liked_posts.json',
          );
      } finally {
        await archive.close();
      }

      // The old source strips .zip from reader.archives, so ordinary Instagram
      // ZIPs already mask their key. This separate realistic parent shape
      // exercises raw ZIP-named path segments without that stripped identity.
      const nested = createMemoryArchive('generated-parent', {
        [`incoming/nested/${name}/likes/liked_posts.json`]: '{"items":[]}',
        'notes.txt': 'Generated sibling.',
      });
      try {
        const report = await describeStructure(nested);
        expect(report.files[0]?.pattern).toBe(
          '<root>/nested/<root>/likes/liked_posts.json',
        );
        for (const identity of FORBIDDEN_IDENTITIES)
          expect(JSON.stringify(report).toLowerCase()).not.toContain(identity);
      } finally {
        await nested.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test('a duplicate-looking ZIP name with extra text remains an unknown name, not an inferred account', async () => {
  const name = 'instagram-rev_handle-2026-01-02-zz9q (1) extra.zip';
  const root = await mkdtemp(join(tmpdir(), 'socialprune-extra-export-name-'));
  try {
    const writer = new ZipWriter(new BlobWriter(), {
      useWebWorkers: false,
      useCompressionStream: true,
    });
    await writer.add('comments/posts.json', new TextReader(COMMENTS));
    const file = join(root, name);
    await writeFile(
      file,
      new Uint8Array(await (await writer.close()).arrayBuffer()),
    );
    const archive = await openArchivePaths([file]);
    try {
      expect(archive.archives).toEqual([name]);
      const report = await describeStructure(archive);
      expect(report.files[0]?.pattern).toBe('comments/posts.json');
      // No recognised account identity is available. The documented unknown
      // plain-key residual remains visible instead of broadening the pattern.
      expect(report.files[0]?.paths).toContainEqual({
        path: '$.rev_handle',
        types: ['string'],
      });
      expect(JSON.stringify(report)).toContain('rev_handle');
      expect(JSON.stringify(report)).not.toContain('zz9q');
    } finally {
      await archive.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
