import { assessment } from './contract.mjs';

// Original short lists, intentionally incomplete and uncalibrated.
const patterns = [
  ['personal-info', 3, /[\w.+-]+@(?:[\w-]+\.)+[a-z]{2,}|(?:\+?1[ -]?)?\(?\d{3}\)?[ -]?555[ -]?01\d{2}|07700[ -]?900\d{3}|\b\d{1,4}\s+[\p{L} ]{2,30}(?:Street|Lane|Road|Avenue)\b|\b[\p{L}]+(?:straße|strasse|weg|gasse)\s+\d{1,4}\b/iu],
  ['personal-attack', 2, /\b(?:du|you(?: are|'re)?|nerlo|veska|fenvik)\b.{0,35}\b(?:idiot|blöder|lazy|faul|fraud|blender|dumm|pathetic)\b/iu],
  ['toxic', 2, /\b(?:idiot(?:en)?|scheiße|scheiss|scheiß|verpisst|bullshit|shitshow|fuck|bescheuert|vollidioten|kotzen)\b/iu],
  ['drugs-illegal', 2, /\b(?:kokain|koks|cocaine|gekifft|gras|weed|cannabis|pillen|pills|joint|vodka|wodka)\b/iu],
  ['sexual', 2, /\b(?:sex(?:witze|ual)?|handschellen|handcuffs|zweideutig\w*|suggestive|innuendo|clothes|kleidungsvorschriften)\b/iu],
  ['political', 0, /\b(?:partei|party|politik|politic\w*|wählen|voted?|voting|election\w*|steuern|taxes|stadtrat|council|minister\w*|gesetz)\b/iu],
];
export function rules(item, source, createdAt) {
  for (const [category, risk, expression] of patterns) {
    const match = item.text.match(expression);
    if (match) return assessment(item, source, createdAt, { category, risk,
      reason: `The baseline matched a ${category} text pattern`, evidence: match[0], confidence: null });
  }
  const text = item.text.trim();
  if (!text || /^https?:\/\/\S+$/.test(text) || !/[\p{L}\p{N}]/u.test(text) || /^(first|ersterrr|lol|lmao|bin da|here now)$/i.test(text)) {
    return assessment(item, source, createdAt, { category: 'empty', risk: 1,
      reason: 'The baseline found little standalone content', evidence: text || null, confidence: null });
  }
  const old = new Date(item.createdAt).getUTCFullYear() <= 2016;
  const noEngagement = item.engagement.likes === 0 && (item.engagement.reposts === 0 || item.engagement.reposts === null);
  const datedStyle = text.match(/!!!|MP3|Teen(?:ager|ie|age)|dunkelste|darkest/iu);
  if (old && noEngagement && datedStyle) return assessment(item, source, createdAt, { category: 'embarrassing', risk: 1,
    reason: 'The baseline combined dated self-presentation with age and zero known likes', evidence: datedStyle[0], confidence: null });
  if (['reply', 'comment'].includes(item.kind) && text.length < 45) return assessment(item, source, createdAt, {
    category: 'unclear', risk: 1, reason: 'The short reply may need its missing parent context', evidence: null, confidence: null });
  return assessment(item, source, createdAt, { category: 'harmless', risk: 0,
    reason: 'The baseline did not match a concern pattern', evidence: null, confidence: null });
}
