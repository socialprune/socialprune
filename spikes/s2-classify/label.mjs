import { readFile, appendFile, open, mkdir, access, writeFile, realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { categoryNames, DEFAULT_CATEGORIES, fixtureDirectory, digest, readJsonl, validateItems, validateLabel, validateLabels } from './contract.mjs';
import { tempRoot } from './machine.mjs';

async function main() {
  const args = process.argv.slice(2);
  const finalize = args.includes('--finalize');
  if (finalize) args.splice(args.indexOf('--finalize'), 1);
  let directory = fileURLToPath(fixtureDirectory);
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--test-dir') throw new Error('Usage: node label.mjs [--finalize] [--test-dir <S2 temporary directory>]');
    directory = path.resolve(args[1]);
    const relative = path.relative(path.resolve(tempRoot), directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('--test-dir must be a child of the S2 temporary directory');
    if (path.resolve(await realpath(directory)) !== directory) throw new Error('--test-dir cannot be a symbolic-link path');
  }
  const items = validateItems(await readJsonl(path.join(directory, 'items.jsonl')));
  const finalFile = path.join(directory, 'labels.jsonl');
  const historyFile = path.join(directory, 'labels.history.jsonl');
  const rubric = await readFile(path.join(directory, 'RUBRIC.md'), 'utf8');
  const identity = { itemsHash: digest(await readFile(path.join(directory, 'items.jsonl'))), rubricHash: digest(rubric) };
  try {
    await access(finalFile);
    validateLabels(items, await readJsonl(finalFile));
    if (finalize) throw new Error('labels.jsonl existiert bereits, Überschreiben abgelehnt.');
    console.log(`Bereits abgeschlossen: ${items.length}/${items.length}, labels.jsonl wird nicht geändert.`);
    return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let events = [];
  try { events = await readJsonl(historyFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stack = [];
  if (events.length) {
    if (events[0].event !== 'rubric-accepted' || events[0].itemsHash !== identity.itemsHash || events[0].rubricHash !== identity.rubricHash) {
      throw new Error('Textset oder Rubrik wurde seit Beginn geändert; keine Fortsetzung mit alten Labels.');
    }
    for (const event of events.slice(1)) {
      if (event.event === 'label') {
        const row = validateLabel(event.label);
        if (row.itemId !== items[stack.length]?.id) throw new Error('Beschädigte Reihenfolge im Verlauf');
        stack.push(row);
      } else if (event.event === 'undo') {
        if (stack.at(-1)?.itemId !== event.itemId) throw new Error('Ungültiges Rückgängig-Ereignis');
        stack.pop();
      } else throw new Error('Unbekanntes Ereignis im Verlauf');
    }
  }
  if (finalize && stack.length !== items.length) throw new Error(`Abschluss abgelehnt: ${stack.length}/${items.length} Labels im Verlauf.`);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async question => { process.stdout.write(question); const line = await lines.next(); return line.done ? null : line.value.trim(); };
  const journal = async event => {
    await appendFile(historyFile, JSON.stringify(event) + '\n', { encoding: 'utf8', flag: 'a' });
    const handle = await open(historyFile, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
  };
  try {
    console.log('S2: Nur von Hand labeln, kein Modell ist beteiligt.');
    console.log('Bitte RUBRIC.md zuerst lesen und den Entwurf bei Bedarf ändern.');
    if (!events.length) {
      const answer = await ask('Rubrik gelesen und für diese Sitzung akzeptiert? Tippe ja: ');
      if (answer !== 'ja') { console.log('Ohne Bestätigung beendet, keine Labels geschrieben.'); return; }
      await mkdir(directory, { recursive: true });
      await journal({ event: 'rubric-accepted', ...identity, at: new Date().toISOString() });
    }
    while (true) {
      if (stack.length === items.length) {
        const counts = Object.fromEntries(DEFAULT_CATEGORIES.map(category => [category, stack.filter(row => row.category === category).length]));
        console.log(`Fortschritt ${stack.length}/${items.length}\n${JSON.stringify(counts)}`);
        if (!finalize) {
          console.log('Alle Labels im Verlauf gespeichert. Zum Abschluss node spikes/s2-classify/label.mjs --finalize ausführen.');
          return;
        }
        const finish = await ask('Alle geprüft. labels.jsonl einmalig abschließen? ja / u rückgängig / q beenden: ');
        if (finish === 'u') { const last = stack.pop(); await journal({ event: 'undo', itemId: last.itemId, at: new Date().toISOString() }); continue; }
        if (finish !== 'ja') { console.log('Verlauf gespeichert, endgültige Labels noch nicht erstellt.'); return; }
        validateLabels(items, stack);
        const finalizedAt = new Date().toISOString();
        const content = stack.map(row => JSON.stringify(row)).join('\n') + '\n';
        const handle = await open(finalFile, 'ax');
        try { await handle.appendFile(content, 'utf8'); await handle.sync(); }
        finally { await handle.close(); }
        await writeFile(path.join(directory, 'labels.manifest.json'), JSON.stringify({ version: 1, ...identity,
          labelsHash: digest(content), labeler: 'maintainer', finalizedAt }, null, 2) + '\n', { flag: 'wx' });
        console.log(`Abgeschlossen: ${stack.length} Labels von maintainer, Datei ${finalFile}`);
        return;
      }
      const item = items[stack.length];
      console.log(`\n[${stack.length + 1}/${items.length}] ${item.id} | ${item.platform} | ${item.kind} | ${item.createdAt}`);
      console.log(`Likes ${item.engagement.likes ?? 'unbekannt'}, Reposts ${item.engagement.reposts ?? 'unbekannt'}`);
      console.log(`Referenzen ${JSON.stringify(item.reference)}\n\n${item.text}\n`);
      DEFAULT_CATEGORIES.forEach((category, i) => console.log(`${i === 9 ? 0 : i + 1} ${categoryNames[i]} (${category})`));
      const choice = await ask('Kategorie 0 bis 9, u letztes Label rückgängig, q beenden: ');
      if (choice === null || choice === 'q') { console.log(`Gespeichert: ${stack.length}/${items.length}, mit demselben Befehl fortsetzen.`); return; }
      if (choice === 'u') {
        if (!stack.length) { console.log('Noch kein Label zum Rückgängigmachen.'); continue; }
        const last = stack.pop(); await journal({ event: 'undo', itemId: last.itemId, at: new Date().toISOString() }); continue;
      }
      if (!/^[0-9]$/.test(choice)) { console.log('Bitte genau eine Ziffer wählen.'); continue; }
      const risk = await ask('Risiko 0 kein Anlass / 1 optional / 2 genau / 3 vorrangig: ');
      if (risk === null) return;
      if (!/^[0-3]$/.test(risk)) { console.log('Ungültiges Risiko, Item bleibt offen.'); continue; }
      const note = await ask('Notiz (optional, Enter für keine): ');
      if (note === null) return;
      const row = validateLabel({ itemId: item.id, category: DEFAULT_CATEGORIES[choice === '0' ? 9 : Number(choice) - 1],
        risk: Number(risk), note, labeledAt: new Date().toISOString(), labeler: 'maintainer' });
      await journal({ event: 'label', label: row }); stack.push(row);
    }
  } finally { rl.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
