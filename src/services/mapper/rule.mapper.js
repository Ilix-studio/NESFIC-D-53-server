// Keyword + number mapping from a transcript to eDAR field values, driven entirely by the
// language pack (keywords, number words, ordinals, time words). No language is hard-coded here.
import { getLang } from '../../lang/index.js';
import { fieldsInSection, getField, getSchema, isRepeatable } from '../../schema/index.js';
import { fieldKey, parseFieldKey } from '../../utils/fieldKey.js';

// Officers are in Assam; stored crash times are local (IST, UTC+05:30).
const LOCAL_OFFSET_MIN = 330;
// A word starts at the beginning of the text or after a space / punctuation mark.
const WORD_START = '(?<=^|[\\s,।;:!?"\'(\\-])';
// Script block of the pack's letters (default Bengali-Assamese): stops a number word or a
// negation word matching the start of a longer word.
const DEFAULT_LETTERS = '\\u0980-\\u09FF';
// A negation word ("নাই", "নাছিল") this close after a phrase, in the same clause, cancels it:
// "কোনো গুৰুতৰ আহত নাই" must not fill severity = grievous.
const NEGATION_WINDOW = 24;
const CLAUSE_END = /[।,;:!?.\n]/;
// Indian registration plates are written in Latin script whatever the spoken language.
const PLATE_RE = /\b([A-Z]{2})[\s-]?(\d{1,2})[\s-]?([A-Z]{1,3})[\s-]?(\d{1,4})\b/;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternation = (words) => [...words].sort((a, b) => b.length - a.length).map(escapeRe).join('|');

const compiled = new Map();

function compile(lang) {
  if (compiled.has(lang)) return compiled.get(lang);
  const pack = getLang(lang);
  const words = pack.numberWords ?? {};
  const wordAlt = alternation(Object.keys(words));
  const notLetterAfter = `(?![${pack.letters ?? DEFAULT_LETTERS}])`;
  const c = {
    pack,
    notLetterAfter,
    negation: pack.negations?.length ? new RegExp(`${WORD_START}(?:${alternation(pack.negations)})${notLetterAfter}`) : null,
    numToken: wordAlt ? `(\\d+|${wordAlt})` : '(\\d+)',
    classifier: pack.classifiers?.length ? `(?:${alternation(pack.classifiers)})?` : '',
    approx: pack.approx?.length ? `(?:(?:${alternation(pack.approx)})\\s*)?` : '',
    toNumber: (tok) => (/^\d+$/.test(tok) ? Number(tok) : words[tok]),
  };
  compiled.set(lang, c);
  return c;
}

/** Native digits -> ASCII. Each digit is one UTF-16 unit, so offsets stay valid. */
function asciiDigits(text, digits) {
  if (!digits) return text;
  return text.replace(new RegExp(`[${digits}]`, 'g'), (d) => String(digits.indexOf(d)));
}

function findAtWordStart(text, phrase) {
  const m = new RegExp(WORD_START + escapeRe(phrase)).exec(text);
  return m ? m.index : -1;
}

function negatedAfter(text, end, c) {
  if (!c.negation) return false;
  let tail = text.slice(end, end + NEGATION_WINDOW);
  const stop = tail.search(CLAUSE_END);
  if (stop >= 0) tail = tail.slice(0, stop);
  return c.negation.test(tail);
}

/** First place a phrase starts a word and is not negated right after (unless it is itself negative). */
function findAffirmed(text, phrase, c) {
  const selfNegative = c.negation?.test(phrase);
  for (const m of text.matchAll(new RegExp(WORD_START + escapeRe(phrase), 'g'))) {
    if (selfNegative || !negatedAfter(text, m.index + phrase.length, c)) return m.index;
  }
  return -1;
}

/** Splits a vehicles/persons transcript on ordinals ("প্ৰথম", "দ্বিতীয়" ...) into instances. */
function segments(text, section, c) {
  if (!isRepeatable(section)) return [{ index: null, start: 0, end: text.length }];
  const ordinals = c.pack.ordinals ?? {};
  const alt = alternation(Object.keys(ordinals));
  const marks = alt ? [...text.matchAll(new RegExp(`${WORD_START}(${alt})`, 'g'))] : [];
  if (!marks.length) return [{ index: 1, start: 0, end: text.length }];
  return marks.map((m, i) => ({
    index: ordinals[m[1]],
    start: i === 0 ? 0 : m.index,
    end: i + 1 < marks.length ? marks[i + 1].index : text.length,
  }));
}

function matchEnum(field, text, seg, c, { useLabels }) {
  const keywords = c.pack.keywords?.[field.id] ?? {};
  const part = text.slice(seg.start, seg.end);
  let best = null;
  field.options.forEach((option, order) => {
    const phrases = [...(keywords[option.code] ?? [])];
    const label = option[`label_${c.pack.code}`];
    if (useLabels && label) phrases.push(label);
    for (const phrase of phrases) {
      const at = findAffirmed(part, phrase, c);
      if (at < 0) continue;
      // Longest phrase wins ("মটৰ চাইকেল" over "চাইকেল"); ties go to the earlier option.
      if (!best || phrase.length > best.len || (phrase.length === best.len && order < best.order)) {
        best = { value: option.code, start: seg.start + at, end: seg.start + at + phrase.length, len: phrase.length, order };
      }
    }
  });
  return best;
}

function matchNumber(field, text, seg, c, { anyNumber }) {
  const cues = c.pack.numberCues?.[field.id] ?? {};
  const part = text.slice(seg.start, seg.end);
  const hit = (value, index, length) => ({ value, start: seg.start + index, end: seg.start + index + length });

  for (const phrase of cues.zero ?? []) {
    const at = findAtWordStart(part, phrase);
    if (at >= 0) return hit(0, at, phrase.length);
  }
  for (const cue of cues.before ?? []) {
    const m = new RegExp(`${WORD_START}${c.numToken}${c.classifier}\\s*${escapeRe(cue)}`).exec(part);
    const n = m && c.toNumber(m[1]);
    if (n != null) return hit(n, m.index, m[0].length);
  }
  for (const cue of cues.after ?? []) {
    const m = new RegExp(`${WORD_START}${escapeRe(cue)}\\s*${c.approx}${c.numToken}${c.notLetterAfter}`).exec(part);
    const n = m && c.toNumber(m[1]);
    if (n != null) return hit(n, m.index, m[0].length);
  }
  if (anyNumber) {
    const m = new RegExp(`${WORD_START}${c.numToken}${c.classifier}${c.notLetterAfter}`).exec(part);
    const n = m && c.toNumber(m[1]);
    if (n != null) return hit(n, m.index, m[0].length);
  }
  return null;
}

function matchTime(text, seg, c, startedAt) {
  const t = c.pack.time;
  if (!t?.hourMarkers?.length) return null;
  const part = text.slice(seg.start, seg.end);
  const periods = alternation(Object.keys(t.periods ?? {}));
  const re = new RegExp(
    `${WORD_START}(?:(${periods || '(?!)'})\\s*)?${c.approx}${c.numToken}\\s*(?:${alternation(t.hourMarkers)})`,
  );
  const m = re.exec(part);
  if (!m) return null;
  let hour = c.toNumber(m[2]);
  if (hour == null || hour > 24) return null;
  const period = m[1] ? t.periods[m[1]] : null;
  if ((period === 'afternoon' || period === 'evening') && hour < 12) hour += 12;
  if (period === 'night' && hour >= 6 && hour < 12) hour += 12;
  if (period === 'noon' && hour < 6) hour += 12;
  hour %= 24;

  // Date comes from when the case was opened (local time). A crash time later than that
  // must have been the previous day (e.g. case opened 00:30, crash at 23:00).
  const opened = new Date(new Date(startedAt ?? Date.now()).getTime() + LOCAL_OFFSET_MIN * 60_000);
  const openedMinutes = opened.getUTCHours() * 60 + opened.getUTCMinutes();
  if (hour * 60 > openedMinutes + 30) opened.setUTCDate(opened.getUTCDate() - 1);
  const date = opened.toISOString().slice(0, 10);
  return { value: `${date}T${String(hour).padStart(2, '0')}:00`, start: seg.start + m.index, end: seg.start + m.index + m[0].length };
}

function matchPlate(text, seg) {
  const m = PLATE_RE.exec(text.slice(seg.start, seg.end));
  if (!m) return null;
  const [, state, district, series, number] = m;
  return { value: `${state}${district.padStart(2, '0')} ${series} ${number}`, start: seg.start + m.index, end: seg.start + m.index + m[0].length };
}

function matchTextPattern(field, text, seg, c) {
  const part = text.slice(seg.start, seg.end);
  for (const p of c.pack.textPatterns?.[field.id] ?? []) {
    const m = new RegExp(p.regex).exec(part);
    if (m) {
      const value = p.template.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? '');
      return { value, start: seg.start + m.index, end: seg.start + m.index + m[0].length };
    }
  }
  return null;
}

function matchField(field, text, seg, c, opts) {
  switch (field.type) {
    case 'enum':
      return matchEnum(field, text, seg, c, opts);
    case 'number':
      return matchNumber(field, text, seg, c, opts);
    case 'datetime':
      return matchTime(text, seg, c, opts.startedAt);
    case 'text':
      return field.id === 'registration_number' ? matchPlate(text, seg) : matchTextPattern(field, text, seg, c);
    default:
      return null; // geo comes from GPS, not speech
  }
}

const singleFields = () => getSchema().fields.filter((f) => !isRepeatable(f.section));

export const ruleMapper = {
  name: 'rule',
  async map({ transcript, section, context = {}, targetKeys }) {
    const raw = transcript?.text ?? '';
    const c = compile(transcript?.lang ?? 'as');
    const text = asciiDigits(raw, c.pack.digits);
    const proposals = [];
    const push = (key, hit, confidence = 0.7) =>
      proposals.push({
        fieldId: key,
        value: hit.value,
        confidence,
        transcriptSpan: { start: hit.start, end: hit.end, text: raw.slice(hit.start, hit.end) },
      });

    // Follow-up answer: only the asked field, and the whole clip is about it.
    if (targetKeys?.length) {
      const whole = { index: null, start: 0, end: text.length };
      for (const key of targetKeys) {
        const field = getField(parseFieldKey(key).fieldId);
        if (!field) continue;
        const hit = matchField(field, text, whole, c, { startedAt: context.startedAt, useLabels: true, anyNumber: true });
        if (hit) push(key, hit, 0.8);
        else if (field.type === 'text' && raw.trim()) push(key, { value: raw.trim(), start: 0, end: raw.length }, 0.5);
      }
      return proposals;
    }

    // crash / road clips fill the single-instance fields; vehicles / persons clips fill
    // their own section, one instance per ordinal.
    const fields = isRepeatable(section) ? fieldsInSection(section) : singleFields();
    for (const seg of segments(text, section, c)) {
      for (const field of fields) {
        const hit = matchField(field, text, seg, c, { startedAt: context.startedAt, useLabels: false, anyNumber: false });
        if (hit) push(fieldKey(field.id, seg.index), hit);
      }
    }
    return proposals;
  },
};
