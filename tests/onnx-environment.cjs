// Jest runs each test file in its own JS context, but onnxruntime-node creates its output
// tensors in Node's main context, so `data instanceof Float32Array` fails inside tests.
// Speech tests use this environment, which shares the main context's typed-array classes.
const { TestEnvironment } = require('jest-environment-node');

class OnnxEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    for (const name of ['Float32Array', 'BigInt64Array', 'Int32Array']) this.global[name] = globalThis[name];
  }
}

module.exports = OnnxEnvironment;
