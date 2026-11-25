import { getField, optionLabel } from '../../schema/index.js';
import { getValue, isEmpty } from '../../utils/caseFields.js';
import { numberOptions, ruleQuestion } from './helpers.js';

const ID = 'fatalButNoDeaths';

// Severity is "Fatal" but persons_killed is 0 or empty.
export default {
  id: ID,
  kind: 'inconsistent',
  run(caseDoc) {
    if (getValue(caseDoc, 'severity') !== 'fatal') return [];
    const killed = getValue(caseDoc, 'persons_killed');
    if (!isEmpty(killed) && Number(killed) > 0) return [];
    return [
      {
        ruleId: ID,
        kind: 'inconsistent',
        fieldIds: ['persons_killed', 'severity'],
        answerType: 'number',
        ...ruleQuestion(caseDoc, ID, (lang) => ({ severity: optionLabel(getField('severity'), 'fatal', lang) })),
        options: numberOptions(1, 2, 3),
        priority: 0,
      },
    ];
  },
};
