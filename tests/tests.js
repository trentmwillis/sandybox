/* global QUnit */
import Sandybox from '../dist/index.js';

const { module, test } = QUnit;

module('Sandybox', () => {
  test('creation of many functions does not take too long', async (assert) => {
    const sandbox = await Sandybox.create();
    const funcPromises = [];
    const expectedResult = [];
    const startTime = Date.now();
    for (let i = 0; i < 2000; i++) {
      funcPromises.push(sandbox.addFunction(`() => ${i}`));
      expectedResult.push(i);
    }
    const funcs = await Promise.all(funcPromises);
    const midTime = Date.now();
    assert.ok(midTime - startTime < 1000);

    const result = await Promise.all(funcs.map((func) => func()));
    assert.ok(Date.now() - midTime < 1000);
    assert.deepEqual(result, expectedResult);
    sandbox.cleanup();
  });

  module('addFunction(string)', () => {
    test('rejects with an error if the code is not valid', async (assert) => {
      const sandbox = await Sandybox.create();
      const result = sandbox.addFunction(
        '() { return this is not valid javascript };'
      );

      await assert.rejects(result, new Error("Unexpected token ')'"));

      sandbox.cleanup();
    });

    test('works for standard function', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(
        function (word, repeat) {
          return word.repeat(repeat);
        }.toString()
      );

      const result = await sandboxedFunction('test', 3);
      assert.equal(result, 'testtesttest');

      sandbox.cleanup();
    });

    test('works for async function', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(
        async function (word, repeat) {
          await Promise.resolve();
          return word.repeat(repeat);
        }.toString()
      );

      const result = await sandboxedFunction('test', 3);
      assert.equal(result, 'testtesttest');

      sandbox.cleanup();
    });

    test('works for arrow function', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(
        ((word, repeat) => {
          return word.repeat(repeat);
        }).toString()
      );

      const result = await sandboxedFunction('test', 3);
      assert.equal(result, 'testtesttest');

      sandbox.cleanup();
    });

    test('works for async arrow function', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(
        (async (word, repeat) => {
          await Promise.resolve();
          return word.repeat(repeat);
        }).toString()
      );

      const result = await sandboxedFunction('test', 3);
      assert.equal(result, 'testtesttest');

      sandbox.cleanup();
    });
  });

  module('addFunction(function)', () => {
    test('works for standard function', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(function (
        word,
        repeat
      ) {
        return word.repeat(repeat);
      });

      const result = await sandboxedFunction('test', 3);
      assert.equal(result, 'testtesttest');

      sandbox.cleanup();
    });

    test('works for async function', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(async function (
        word,
        repeat
      ) {
        await Promise.resolve();
        return word.repeat(repeat);
      });

      const result = await sandboxedFunction('test', 3);
      assert.equal(result, 'testtesttest');

      sandbox.cleanup();
    });

    test('works for arrow function', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction((word, repeat) => {
        return word.repeat(repeat);
      });

      const result = await sandboxedFunction('test', 3);
      assert.equal(result, 'testtesttest');

      sandbox.cleanup();
    });

    test('works for async arrow function', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(
        async (word, repeat) => {
          await Promise.resolve();
          return word.repeat(repeat);
        }
      );

      const result = await sandboxedFunction('test', 3);
      assert.equal(result, 'testtesttest');

      sandbox.cleanup();
    });
  });

  module('removeFunction', () => {
    test('causes all pending executions to reject', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(() => 'hi');

      const result1 = sandboxedFunction();
      const result2 = sandboxedFunction();

      sandbox.removeFunction(sandboxedFunction);

      await assert.rejects(
        result1,
        new Error('Function has been removed from sandbox.')
      );
      await assert.rejects(
        result2,
        new Error('Function has been removed from sandbox.')
      );

      sandbox.cleanup();
    });

    test('causes function to return a rejection when invoked again', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(() => 'hi');

      sandbox.removeFunction(sandboxedFunction);

      const result = sandboxedFunction();
      await assert.rejects(
        result,
        new Error('Function has been removed from sandbox.')
      );

      sandbox.cleanup();
    });
  });

  module('cleanup', () => {
    test('removes the iframe from the page', async (assert) => {
      const sandbox = await Sandybox.create();
      assert.ok(document.querySelector('iframe'));

      sandbox.cleanup();
      assert.notOk(document.querySelector('iframe'));
    });

    test('causes all functions to be removed', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction1 = await sandbox.addFunction(() => 'hi');
      const sandboxedFunction2 = await sandbox.addFunction(() => 'hello');

      const pending1 = sandboxedFunction1();
      const pending2 = sandboxedFunction2();

      sandbox.cleanup();

      await assert.rejects(
        pending1,
        new Error('Function has been removed from sandbox.')
      );
      await assert.rejects(
        pending2,
        new Error('Function has been removed from sandbox.')
      );

      await assert.rejects(
        sandboxedFunction1(),
        new Error('Function has been removed from sandbox.')
      );
      await assert.rejects(
        sandboxedFunction2(),
        new Error('Function has been removed from sandbox.')
      );
    });

    test('causes future invocations of addFunction to reject when invoked', async (assert) => {
      const sandbox = await Sandybox.create();
      sandbox.cleanup();

      const result = sandbox.addFunction(() => 'hi');
      await assert.rejects(result, new Error('Sandbox has been cleaned up.'));
    });
  });
});
