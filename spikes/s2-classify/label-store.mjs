import { readFile, open, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { digest, readJsonl, validateLabel, validateLabels, validateSelections } from './contract.mjs';

export async function openLabelStore({ items, newIds, rubric, directory }) {
  await mkdir(directory, { recursive: true });
  const lock = await open(path.join(directory, 'session.lock'), 'wx');
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
  const identity = { version: 2, itemsHash: digest(JSON.stringify(items)), rubricHash: digest(rubric) };
  const historyFile = path.join(directory, 'labels.history.jsonl');
  let events;
  try { events = await readJsonl(historyFile); }
  catch (error) { if (error.code !== 'ENOENT') { await lock.close(); await import('node:fs/promises').then(fs => fs.unlink(path.join(directory, 'session.lock'))); throw error; } events = []; }
  const state = { revision: 0, read: 0, accepted: false, cursor: 0, labels: new Map(), undo: [], finalized: false };
  const ids = new Set(items.map(item => item.id));
  function apply(event) {
    if (event.event === 'opened') {
      if (state.revision || JSON.stringify(event.identity) !== JSON.stringify(identity)) throw new Error('DATA_CHANGED: item set or rubric changed; resume refused');
    } else if (!state.revision) throw new Error('Invalid journal header');
    else if (event.event === 'read-new') {
      if (event.itemId !== newIds[state.read]) throw new Error('Invalid reading order');
      state.read++;
    } else if (event.event === 'accepted') {
      if (state.read !== newIds.length || state.accepted) throw new Error('Read the additions before accepting');
      state.accepted = true;
    } else if (event.event === 'save') {
      if (!state.accepted || !ids.has(event.label?.itemId) || event.label.itemId !== items[state.cursor]?.id) throw new Error('Invalid label target');
      validateLabel(event.label);
      state.undo.push({ itemId: event.label.itemId, prior: state.labels.get(event.label.itemId) ?? null, cursor: state.cursor });
      state.labels.set(event.label.itemId, event.label);
      state.cursor = event.cursor;
    } else if (event.event === 'undo') {
      const last = state.undo.pop();
      if (!last || last.itemId !== event.itemId) throw new Error('Invalid undo');
      if (last.prior) state.labels.set(last.itemId, last.prior); else state.labels.delete(last.itemId);
      state.cursor = last.cursor;
    } else if (event.event === 'move') state.cursor = event.cursor;
    else if (event.event === 'finalized') state.finalized = true;
    else throw new Error('Unknown journal event');
    if (!Number.isInteger(state.cursor) || state.cursor < 0 || state.cursor >= items.length) throw new Error('Invalid cursor');
    state.revision++;
  }
  async function journal(event) {
    const handle = await open(historyFile, 'a');
    try { await handle.appendFile(JSON.stringify(event) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    apply(event);
  }
  try {
    for (const event of events) apply(event);
    if (!events.length) await journal({ event: 'opened', identity });
    // A partial finalization must not permit more labels or silently overwrite files.
    for (const name of ['labels.jsonl', 'labels.manifest.json']) {
      try { await readFile(path.join(directory, name)); state.finalized = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  } catch (error) { await lock.close(); await import('node:fs/promises').then(fs => fs.unlink(path.join(directory, 'session.lock'))); throw error; }
  function view() {
    return { revision: state.revision, read: state.read, readTotal: newIds.length, accepted: state.accepted,
      finalized: state.finalized, progress: state.labels.size, total: items.length, cursor: state.cursor,
      canUndo: state.undo.length > 0,
      // Only a person's earlier label may appear, never an authoring intent or model result.
      currentLabel: state.labels.get(items[state.cursor].id) ?? null,
      item: !state.accepted && state.read < newIds.length ? items.find(item => item.id === newIds[state.read]) : items[state.cursor] };
  }
  let queue = Promise.resolve();
  async function act(action) {
    if (!action || action.revision !== state.revision) throw new Error('STALE_VIEW');
    if (state.finalized) throw new Error('FINALIZED: no further writes');
    const at = new Date().toISOString();
    if (action.type === 'read-new') {
      if (state.accepted || state.read >= newIds.length) throw new Error('Reading pass finished');
      await journal({ event: 'read-new', itemId: newIds[state.read], at });
    } else if (action.type === 'accept') {
      if (state.read !== newIds.length || state.accepted) throw new Error('Read the additions first');
      await journal({ event: 'accepted', at });
    } else {
      if (!state.accepted) throw new Error('Accept the rubric first');
      if (action.type === 'save') {
        validateSelections(action.labels);
        const label = validateLabel({ itemId: items[state.cursor].id, labels: action.labels, note: action.note,
          labeledAt: at, labeler: 'maintainer' });
        let cursor = (state.cursor + 1) % items.length;
        for (let n = 1; n < items.length; n++) {
          const candidate = (state.cursor + n) % items.length;
          if (!state.labels.has(items[candidate].id)) { cursor = candidate; break; }
        }
        await journal({ event: 'save', label, cursor });
      } else if (action.type === 'undo') {
        if (!state.undo.length) throw new Error('Nothing to undo');
        await journal({ event: 'undo', itemId: state.undo.at(-1).itemId, at });
      } else if (['skip', 'back'].includes(action.type)) {
        await journal({ event: 'move', cursor: (state.cursor + (action.type === 'back' ? items.length - 1 : 1)) % items.length, at });
      } else if (action.type === 'finalize') {
        if (state.labels.size !== items.length) throw new Error('Labels must cover every item before finalization');
        const rows = items.map(item => state.labels.get(item.id));
        validateLabels(items, rows);
        const content = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
        const handle = await open(path.join(directory, 'labels.jsonl'), 'wx');
        // The exclusive create is already an effect. A failed write must lock this session too.
        state.finalized = true;
        try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
        // Lock writes even if manifest creation fails. Evaluation still refuses the incomplete snapshot.
        const manifest = await open(path.join(directory, 'labels.manifest.json'), 'wx');
        try { await manifest.writeFile(JSON.stringify({ ...identity, labelsHash: digest(content), labeler: 'maintainer', finalizedAt: at }, null, 2) + '\n'); await manifest.sync(); }
        finally { await manifest.close(); }
        await journal({ event: 'finalized', at });
      } else throw new Error('Unknown action');
    }
    return view();
  }
  return { view, action(action) { const next = queue.then(() => act(action)); queue = next.catch(() => {}); return next; },
    async close() { await queue; await lock.close(); await import('node:fs/promises').then(fs => fs.unlink(path.join(directory, 'session.lock'))); } };
}
