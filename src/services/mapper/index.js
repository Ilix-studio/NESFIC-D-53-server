// FieldMapper: map({ transcript, section, schema, currentFields, context, targetKeys })
//   -> [{ fieldId, value, transcriptSpan: { start, end, text }, confidence }]
// Callers must still check every proposal against the schema (see caseState.applyProposals).
import { env } from '../../config/env.js';
import { llmMapper } from './llm.mapper.js';
import { ruleMapper } from './rule.mapper.js';

const engines = { rule: ruleMapper, llm: llmMapper };

export function getMapper(name = env.MAPPER_ENGINE) {
  const engine = engines[name];
  if (!engine) throw new Error(`Unknown mapper engine "${name}"`);
  return engine;
}
