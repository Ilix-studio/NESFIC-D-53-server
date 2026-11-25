// Runs every rule over a case. Each rule exports { id, kind, run(caseDoc, schema) => Finding[] },
// where Finding = { ruleId, kind, fieldIds, answerType, questionEn, questionAs, options, priority }.
import { getSchema } from '../../schema/index.js';
import deathsButNotFatal from './deathsButNotFatal.rule.js';
import fatalButNoDeaths from './fatalButNoDeaths.rule.js';
import nightButDaylight from './nightButDaylight.rule.js';
import requiredMissing from './requiredMissing.rule.js';
import vehicleCountMismatch from './vehicleCountMismatch.rule.js';

export const rules = [nightButDaylight, fatalButNoDeaths, deathsButNotFatal, vehicleCountMismatch, requiredMissing];

export function runRules(caseDoc, schema = getSchema()) {
  return rules.flatMap((rule) => rule.run(caseDoc, schema));
}
