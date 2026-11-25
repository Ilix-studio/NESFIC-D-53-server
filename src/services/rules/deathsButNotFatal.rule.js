import { getField, optionLabel } from '../../schema/index.js';
import { getValue, isEmpty } from '../../utils/caseFields.js';
import { optionsOf, ruleQuestion } from './helpers.js';

const ID = 'deathsButNotFatal';

// persons_killed > 0 but severity is set to something other than "Fatal".
export default {
  id: ID,
  kind: 'inconsistent',
  run(caseDoc) {
    const killed = Number(getValue(caseDoc, 'persons_killed'));
    const severity = getValue(caseDoc, 'severity');
    if (!(killed > 0) || isEmpty(severity) || severity === 'fatal') return [];
    const field = getField('severity');
    return [
      {
        ruleId: ID,
        kind: 'inconsistent',
        fieldIds: ['severity', 'persons_killed'],
        answerType: 'enum',
        ...ruleQuestion(caseDoc, ID, (lang) => ({ killed, severity: optionLabel(field, severity, lang) })),
        options: optionsOf(field),
        priority: 0,
      },
    ];
  },
};
