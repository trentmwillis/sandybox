/* global QUnit */
import Sandybox, { SandboxError } from '../dist/index.js';

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

  test('forwards all arguments', async (assert) => {
    const sandbox = await Sandybox.create();
    const sandboxedFunction = await sandbox.addFunction(function () {
      return { args: [].slice.call(arguments) };
    });

    const result = await sandboxedFunction('hi', true, 1234, { foo: [] });
    assert.deepEqual(result, {
      args: ['hi', true, 1234, { foo: [] }],
    });

    sandbox.cleanup();
  });

  module('dangerouslyAllowSameOrigin', () => {
    test('creates an iframe with allow-same-origin', async (assert) => {
      const sandbox = await Sandybox.create({
        dangerouslyAllowSameOrigin: true,
      });
      assert.equal(
        document.querySelector('.sandybox').getAttribute('sandbox'),
        'allow-scripts allow-same-origin'
      );

      sandbox.cleanup();
    });
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

    test('works with functions returned by a closure', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(`
        (() => {
          const state = { count: 0 };
          return increment => {
            state.count += increment;
            return state.count;
          };
        })()
      `);

      const result1 = await sandboxedFunction(10);
      const result2 = await sandboxedFunction(5);

      assert.equal(result1, 10);
      assert.equal(result2, 15);

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

    test('handles error in standard function', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(
        function () {
          throw new Error('Oops!');
        }.toString()
      );

      const result = sandboxedFunction();
      await assert.rejects(result, new Error('Oops!'));

      sandbox.cleanup();
    });

    test('handles error in async function', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(
        async function () {
          throw new Error('Oops!');
        }.toString()
      );

      const result = sandboxedFunction();
      await assert.rejects(result, new Error('Oops!'));

      sandbox.cleanup();
    });

    test('handles error in arrow function', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(
        (() => {
          throw new Error('Oops!');
        }).toString()
      );

      const result = sandboxedFunction();
      await assert.rejects(result, new Error('Oops!'));

      sandbox.cleanup();
    });

    test('handles error in async arrow function', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(
        (async () => {
          throw new Error('Oops!');
        }).toString()
      );

      const result = sandboxedFunction();
      await assert.rejects(result, new Error('Oops!'));

      sandbox.cleanup();
    });

    test('handles non-clonable objects', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(
        function () {
          return () => 'no good';
        }.toString()
      );

      const result = sandboxedFunction();
      await assert.rejects(
        result,
        new Error(
          "A non-clonable object was returned from a sandboxed function. Original message: Failed to execute 'postMessage' on 'MessagePort': () => 'no good' could not be cloned."
        )
      );

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

    test('handles error in standard function', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(function () {
        throw new Error('Oops!');
      });

      const result = sandboxedFunction();
      await assert.rejects(result, new Error('Oops!'));

      sandbox.cleanup();
    });

    test('handles error in async function', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(async function () {
        throw new Error('Oops!');
      });

      const result = sandboxedFunction();
      await assert.rejects(result, new Error('Oops!'));

      sandbox.cleanup();
    });

    test('handles error in arrow function', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(() => {
        throw new Error('Oops!');
      });

      const result = sandboxedFunction();
      await assert.rejects(result, new Error('Oops!'));

      sandbox.cleanup();
    });

    test('handles error in async arrow function', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(async () => {
        throw new Error('Oops!');
      });

      const result = sandboxedFunction();
      await assert.rejects(result, new Error('Oops!'));

      sandbox.cleanup();
    });

    test('handles non-clonable objects', async (assert) => {
      const sandbox = await Sandybox.create();
      const sandboxedFunction = await sandbox.addFunction(function () {
        return () => 'no good';
      });

      const result = sandboxedFunction();
      await assert.rejects(
        result,
        new Error(
          "A non-clonable object was returned from a sandboxed function. Original message: Failed to execute 'postMessage' on 'MessagePort': () => 'no good' could not be cloned."
        )
      );

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
        new SandboxError('Function has been removed from sandbox.')
      );
      await assert.rejects(
        result2,
        new SandboxError('Function has been removed from sandbox.')
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
        new SandboxError('Function has been removed from sandbox.')
      );

      sandbox.cleanup();
    });
  });

  module('cleanup', () => {
    test('removes the iframe from the page', async (assert) => {
      const sandbox = await Sandybox.create();
      const iframe = document.querySelector('.sandybox');
      assert.ok(iframe);
      assert.equal(iframe.getAttribute('sandbox'), 'allow-scripts');

      sandbox.cleanup();
      assert.notOk(document.querySelector('.sandybox'));
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
        new SandboxError('Function has been removed from sandbox.')
      );
      await assert.rejects(
        pending2,
        new SandboxError('Function has been removed from sandbox.')
      );

      await assert.rejects(
        sandboxedFunction1(),
        new SandboxError('Function has been removed from sandbox.')
      );
      await assert.rejects(
        sandboxedFunction2(),
        new SandboxError('Function has been removed from sandbox.')
      );
    });

    test('causes all pending invocations of addFunction to reject', async (assert) => {
      const sandbox = await Sandybox.create();

      const pending1 = sandbox.addFunction(() => 'hi');
      const pending2 = sandbox.addFunction(() => 'hi');

      sandbox.cleanup();

      await assert.rejects(
        pending1,
        new SandboxError('Sandbox has been cleaned up.')
      );
      await assert.rejects(
        pending2,
        new SandboxError('Sandbox has been cleaned up.')
      );
    });

    test('causes future invocations of addFunction to reject when invoked', async (assert) => {
      const sandbox = await Sandybox.create();
      sandbox.cleanup();

      const result = sandbox.addFunction(() => 'hi');
      await assert.rejects(
        result,
        new SandboxError('Sandbox has been cleaned up.')
      );
    });
  });
});
