// Returns synthetic Assamese transcripts from test-data/ so the whole flow can be demoed
// before any speech API key exists. The audio file must exist but its content is ignored.
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';

import { parseFieldKey } from '../../utils/fieldKey.js';

const samples = JSON.parse(readFileSync(new URL('../../../test-data/transcripts.as.json', import.meta.url), 'utf8'));

export const mockAsr = {
  name: 'mock',
  async transcribe(filePath, lang, { section, targetKeys = [] } = {}) {
    await access(filePath);
    if (lang !== 'as') throw new Error(`Mock ASR only has Assamese samples (asked for "${lang}")`);
    let text;
    if (section === 'followup') {
      const { fieldId } = parseFieldKey(targetKeys[0] ?? '');
      text = samples.followupAnswers[fieldId] ?? samples.followupAnswers._default;
    } else {
      text = samples.sections[section];
    }
    if (!text) throw new Error(`No mock transcript for section "${section}"`);
    return { text, lang, engine: 'mock', confidence: 0.9 };
  },
};
