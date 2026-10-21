const $ = id => document.getElementById(id);
const keys = ['q','w','e','r','t','y','i','o','h','?','a','s','d','f'];
const names = { toxic: 'Toxic', 'personal-attack': 'Personal attack', political: 'Political', sexual: 'Sexual',
  'drugs-illegal': 'Drugs / illegal conduct', 'personal-info': 'Personal information', embarrassing: 'Embarrassing',
  empty: 'Empty', harmless: 'Harmless', unclear: 'Unclear', racist: 'Racist', misogynistic: 'Misogynistic',
  'group-hostility': 'Hostile to groups', 'politically-incorrect': 'Politically incorrect' };
const copy = {
  de: { title: 'Von Hand labeln', theme: 'Ansicht wechseln', privacy: 'Erfundene Einträge. Nur deine Labels, kein Modell. Alles bleibt in der lokalen Datei dieses Spikes.',
    reading: 'Zuerst die 160 neuen Einträge lesen', readingHelp: 'Hier werden noch keine Labels erfasst. Lies jeden neuen Eintrag, bevor du die Rubrik annimmst. Die Reihenfolge zeigt keine Kategorien oder Antworten.',
    rubric: 'Rubrik v2 lesen', accept: 'Neue Einträge gelesen, Rubrik annehmen', read: 'Gelesen, nächster Eintrag →',
    choose: 'Welche Kategorien passen?', help: 'Kategorien mit den Buchstaben auf den Buttons oder ? wählen. Ziffern 0 bis 3 setzen nur das Risiko der zuletzt gewählten Kategorie. Mehrere Kategorien möglich; Harmlos und Unklar stehen allein. Kategorie erneut drücken entfernt sie.',
    risk: 'Risiko 0 bis 3: zuerst eine Kategorie wählen', riskFor: name => `Risiko für ${name} wählen: 0 bis 3`, note: 'Deine Notiz (optional)', back: '← Zurück [B]', skip: 'Überspringen [N]', undo: 'Rückgängig [U]',
    save: 'Label speichern [Enter]', finalize: 'Alle Labels einmalig abschließen', details: 'Datum, Resonanz und Referenzen',
    completed: 'Labels abgeschlossen. Die Dateien werden nicht überschrieben.', saved: 'Gespeichert. Schließen und später mit demselben Befehl fortsetzen.',
    confirm: 'Alle Labels endgültig als deine Handlabels abschließen? Die Dateien werden einmalig erstellt.',
    risks: ['Kein Anlass', 'Optional prüfen', 'Genau prüfen', 'Vorrangig prüfen'], prior: 'Dein früheres Label',
    progress: (n,t,r,rt) => `${n} von ${t} gelabelt · Neue Einträge gelesen: ${r}/${rt}`, noRisk: 'Buchstaben und ? wählen Kategorien, 0 bis 3 nur das Risiko. Enter speichert, N überspringt, B geht zurück, U macht das letzte Label rückgängig.' },
  en: { title: 'Label by hand', theme: 'Switch appearance', privacy: 'Invented entries. Your labels only, no model. Everything stays in the local file for this spike.',
    reading: 'Read the 160 new entries first', readingHelp: 'No labels are recorded in this pass. Read each new entry before accepting the rubric. The order reveals no categories or answers.',
    rubric: 'Read rubric v2', accept: 'New entries read, accept rubric', read: 'Read, next entry →',
    choose: 'Which categories apply?', help: 'Choose categories with the letters on the buttons or ?. Digits 0 to 3 only set the risk for the most recently selected category. Choose more than one if needed; Harmless and Unclear stand alone. Press a category again to remove it.',
    risk: 'Risk 0 to 3: choose a category first', riskFor: name => `Choose risk for ${name}: 0 to 3`, note: 'Your note (optional)', back: '← Back [B]', skip: 'Skip [N]', undo: 'Undo [U]',
    save: 'Save label [Enter]', finalize: 'Finalize all labels once', details: 'Date, engagement and references',
    completed: 'Labels finalized. The files will not be overwritten.', saved: 'Saved. Close and resume later with the same command.',
    confirm: 'Finalize all labels as your hand labels? The files will be created once.', risks: ['No concern', 'Optional review', 'Review closely', 'Priority review'], prior: 'Your earlier label',
    progress: (n,t,r,rt) => `${n} of ${t} labelled · New entries read: ${r}/${rt}`, noRisk: 'Letters and ? choose categories, 0 to 3 only set risk. Enter saves, N skips, B goes back, U undoes the last label.' },
};
let lang = localStorage.getItem('s2-language') === 'en' ? 'en' : 'de';
let theme = localStorage.getItem('s2-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let state, metadata, selected = new Map(), active = null, busy = false;
function select(category) {
  if (selected.has(category)) { selected.delete(category); active = null; }
  else {
    if (['harmless','unclear'].includes(category)) selected.clear();
    else { selected.delete('harmless'); selected.delete('unclear'); }
    selected.set(category, null); active = category;
  }
  render();
}
async function action(type) {
  if (busy) return;
  busy = true; $('error').textContent = ''; render();
  try {
    const response = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-S2-Token': metadata.token },
      body: JSON.stringify({ type, revision: state.revision, labels: [...selected].map(([category,risk]) => ({ category,risk })), note: $('note').value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    state = result; resetDraft(); $('notice').textContent = copy[lang].saved;
  } catch (error) { $('error').textContent = error.message; }
  finally { busy = false; render(); }
}
function resetDraft() {
  selected = new Map((state.currentLabel?.labels ?? []).map(label => [label.category, label.risk]));
  active = null; $('note').value = state.currentLabel?.note ?? '';
}
function render() {
  const c = copy[lang]; document.documentElement.lang = lang; document.documentElement.dataset.theme = theme;
  document.title = `S2 · ${c.title}`;
  for (const id of ['title','theme','privacy','choose','help','back','skip','undo','save','finalize','accept','read']) $(id).textContent = c[id];
  $('lang').textContent = lang === 'de' ? 'English' : 'Deutsch'; $('intro-title').textContent = c.reading; $('intro-text').textContent = c.readingHelp;
  $('rubric-title').textContent = c.rubric; $('rubric').textContent = metadata.rubric;
  $('risk-title').textContent = active ? c.riskFor(lang === 'de' ? metadata.categories.find(row => row.id === active).de : names[active]) : c.risk;
  $('note-title').textContent = c.note; $('details-title').textContent = c.details;
  $('progress').textContent = c.progress(state.progress,state.total,state.read,state.readTotal);
  $('meter').max = state.accepted ? state.total : state.readTotal; $('meter').value = state.accepted ? state.progress : state.read;
  $('intro').hidden = state.accepted; $('accept').hidden = state.read !== state.readTotal; $('read').hidden = state.accepted || state.read === state.readTotal;
  $('controls').hidden = !state.accepted || state.finalized; $('item').hidden = (!state.accepted && state.read === state.readTotal) || state.finalized;
  $('meta').textContent = `${state.item.id} · ${state.item.platform} · ${state.item.kind} · ${state.item.createdAt.slice(0,10)}`;
  $('text').textContent = state.item.text;
  $('details').textContent = JSON.stringify({ engagement: state.item.engagement, reference: state.item.reference }, null, 2);
  $('categories').replaceChildren(...metadata.categories.map((category,i) => {
    const button = document.createElement('button'); button.dataset.category = category.id; button.title = category.definition;
    button.setAttribute('aria-pressed', String(selected.has(category.id)));
    const key = document.createElement('kbd'); key.textContent = keys[i].toUpperCase(); button.append(key, document.createTextNode(lang === 'de' ? category.de : names[category.id]));
    if (selected.has(category.id)) { const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = selected.get(category.id) ?? '?'; button.append(badge); }
    button.onclick = () => select(category.id); button.disabled = busy; return button;
  }));
  $('risk-buttons').replaceChildren(...c.risks.map((text,risk) => {
    const button = document.createElement('button'); button.textContent = `${risk} · ${text}`; button.dataset.risk = risk;
    button.setAttribute('aria-pressed', String(active !== null && selected.get(active) === risk));
    button.disabled = active === null || busy; button.onclick = () => { selected.set(active,risk); render(); }; return button;
  }));
  $('save').disabled = busy || !selected.size || [...selected.values()].some(value => value === null);
  $('undo').disabled = busy || !state.canUndo; $('back').disabled = busy; $('skip').disabled = busy; $('read').disabled = busy; $('accept').disabled = busy;
  $('finalize').hidden = state.progress !== state.total; $('finalize').disabled = busy;
  if (state.finalized) $('notice').textContent = c.completed;
  else if (!state.accepted) $('notice').textContent = '';
  else if (!state.currentLabel) $('notice').textContent = c.noRisk;
  else $('notice').textContent = c.prior;
}
$('lang').onclick = () => { lang = lang === 'de' ? 'en' : 'de'; localStorage.setItem('s2-language',lang); render(); };
$('theme').onclick = () => { theme = theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('s2-theme',theme); render(); };
for (const type of ['back','skip','undo','save','accept']) $(type).onclick = () => action(type);
$('read').onclick = () => action('read-new');
$('finalize').onclick = () => { if (confirm(copy[lang].confirm)) action('finalize'); };
document.addEventListener('keydown', event => {
  if (event.repeat || busy || ['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (!state.accepted || state.finalized) return;
  if (/^[0-3]$/.test(key)) { event.preventDefault(); if (active !== null) { selected.set(active,Number(key)); render(); } return; }
  if (keys.includes(key)) { event.preventDefault(); select(metadata.categories[keys.indexOf(key)].id); }
  else if (key === 'escape') { active = null; render(); }
  else if (['b','n','u'].includes(key)) { event.preventDefault(); action({ b:'back',n:'skip',u:'undo' }[key]); }
  else if (key === 'enter' && !$('save').disabled) { event.preventDefault(); action('save'); }
});
try { const response = await fetch('/api/state'); if (!response.ok) throw new Error('STATE_UNAVAILABLE'); metadata = state = await response.json(); resetDraft(); render(); }
catch (error) { $('error').textContent = error.message; }
