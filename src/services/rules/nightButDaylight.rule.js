import { getField, optionLabel } from '../../schema/index.js';
import { getValue, hourOf, timeOf } from '../../utils/caseFields.js';
import { optionsOf, ruleQuestion } from './helpers.js';

const ID = 'nightButDaylight';
const NIGHT_OPTIONS = ['night_street_lights', 'night_lights_not_working', 'night_no_lights'];

// Crash time is between 18:00 and 05:59 but lighting says "Daylight".
export default {
  id: ID,
  kind: 'inconsistent',
  run(caseDoc) {
    const when = getValue(caseDoc, 'crash_datetime');
    const hour = hourOf(when);
    if (getValue(caseDoc, 'lighting') !== 'daylight' || hour === null) return [];
    if (hour >= 6 && hour < 18) return [];
    const lighting = getField('lighting');
    return [
      {
        ruleId: ID,
        kind: 'inconsistent',
        fieldIds: ['lighting', 'crash_datetime'],
        answerType: 'enum',
        ...ruleQuestion(caseDoc, ID, (lang) => ({ time: timeOf(when), lighting: optionLabel(lighting, 'daylight', lang) })),
        options: optionsOf(lighting, NIGHT_OPTIONS),
        priority: 0,
      },
    ];
  },
};
