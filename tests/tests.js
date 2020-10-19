/* global QUnit */
import Sandybox from '../dist/index.min.js';

const { module, test } = QUnit;

module('Sandybox', () => {
  test('works for function with no arguments', async (assert) => {
    const sandbox = await Sandybox.create();
    const sandboxedFunction = await sandbox.addFunction(() => 'hi');
    const result = await sandboxedFunction();
    assert.equal(result, 'hi');
    sandbox.cleanup();
  });

  test('works for function with arguments', async (assert) => {
    const sandbox = await Sandybox.create();
    const sandboxedFunction = await sandbox.addFunction((repeat, word) => {
      let result = '';
      for (let i = 0; i < repeat; i++) {
        result += word;
      }
      return result;
    });
    const result = await sandboxedFunction(3, 'test');
    assert.equal(result, 'testtesttest');
    sandbox.cleanup();
  });

  module('addFunction(string)');

  module('addFunction(function)');

  module('removeFunction', () => {
    test('causes all pending executions to reject');

    test('causes function to return a rejection when invoked again');
  });

  module('cleanup', () => {
    test('removes the iframe from the page');

    test('causes all functions to be removed');

    test(
      'causes future invocations of addFunction to return rejections when invoked'
    );
  });
});
