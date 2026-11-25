import { getField } from '../../schema/index.js';
import { expectedKeys, getValue, isEmpty } from '../../utils/caseFields.js';
import { parseFieldKey } from '../../utils/fieldKey.js';
import { fieldQuestion, optionsOf } from './helpers.js';

const ID = 'requiredMissing';

// A required field is still empty. Repeatable fields are checked for every vehicle / person.
export default {
  id: ID,
  kind: 'missing',
  run(caseDoc) {
    const findings = [];
    for (const key of expectedKeys(caseDoc)) {
      const field = getField(parseFieldKey(key).fieldId);
      if (!field.required || !isEmpty(getValue(caseDoc, key))) continue;
      findings.push({
        ruleId: ID,
        kind: 'missing',
        fieldIds: [key],
        answerType: field.type,
        ...fieldQuestion(caseDoc, key),
        options: field.type === 'enum' ? optionsOf(field) : [],
        priority: field.priority,
      });
    }
    return findings;
  },
};
