import { describedInstances, getValue } from '../../utils/caseFields.js';
import { numberOptions, ruleQuestion } from './helpers.js';

const ID = 'vehicleCountMismatch';

// vehicles_count says N but fewer vehicles are described. Waits until at least one
// vehicle has been described, so it does not fire before the vehicles section is recorded.
export default {
  id: ID,
  kind: 'inconsistent',
  run(caseDoc) {
    const count = Number(getValue(caseDoc, 'vehicles_count'));
    const described = describedInstances(caseDoc, 'vehicles');
    if (!(count > 0) || described === 0 || described >= count) return [];
    return [
      {
        ruleId: ID,
        kind: 'inconsistent',
        fieldIds: ['vehicles_count'],
        answerType: 'number',
        ...ruleQuestion(caseDoc, ID, () => ({ count, described })),
        options: numberOptions(described, count),
        priority: 0,
      },
    ];
  },
};
