// Later: an LLM with strict JSON-schema output, allowed only the field ids and enum codes
// in the eDAR schema. Stub for now; MAPPER_ENGINE=rule is the working engine.
export const llmMapper = {
  name: 'llm',
  async map() {
    throw new Error('LLM mapper is not implemented yet (set MAPPER_ENGINE=rule)');
  },
};
