# Sandybox

**Sandybox** is a tiny, experimental library to allow you to execute arbitrary JavaScript functions safely in a sandbox.

## Goals

**Sandybox** has three primary goals, to be:

1. **Sandboxed (secure)** - Functions should _not_ be able to access any same-origin information or make requests as if it were from the same-origin as the host.
2. **Non-blocking** - Functions should not be able to block the main thread.
3. **Performant** - Functions should be able to be created and executed with minimal overhead compared to a normal function.

In short, functions should be totally separated from the main application and thus safe to run.

### Future Goals

In the future, **Sandybox** should be:

1. **Compartmentalized** - Functions in the sandbox should not be able to influence each other, such as by modifying global objects.

## Architecture

**Sandybox** creates function sandboxes by instantiating a [sandboxed iframe](https://www.html5rocks.com/en/tutorials/security/sandboxed-iframes/) and then creating a [Web Worker](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers) in the iframe. This meets the first two goals of the project, any code executed within the web worker will be **secure** and **non-blocking**.

However, in order to communicate with the web worker, you'll need to transfer any data to the iframe and then to the web worker which is definitely _not_ performant.

To solve this problem, we can use a [MessageChannel](https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel). We keep one port of the channel in the main thread and then send the other one to the web worker, giving us a direct line to the web worker. This will give us the minimal amount of overhead that we could possibly get for code running in a separate thread. In other words, it'll be **performant**.

Finally, we currently have no good solution to **compartmentalization**. The only standardized way to achieve it at this point in time would be to create separate web workers for each function, but this would be much harder to make performant. Given this was the lowest priority goal, this has not been implemented and instead moved to a _future_ goal.

In the future, [Realms](https://github.com/tc39/proposal-realms) or, more likely, [Compartments](https://github.com/tc39/proposal-compartments) should make compartmentalization easy, but it is likely a long way until either is standardized.

## Limitations

The following are known limitations and/or explicit trade-offs of **Sandybox**:

1. **No DOM access** - Given that sandboxed functions run in a web worker, there is no direct DOM access. Allowing DOM access would make it impossible to be non-blocking at this point in time.
2. **Data limited by the [structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)** - Due to running in a separate execution context, only objects that can be cloned can be sent into or received from the functions.
3. **Functions can block each other** - While the functions are guaranteed to not block the main thread, a function in the sandbox can block another function in the sandbox. It would be impossible to guarantee this doesn't happen as browsers can only start a finite number of threads.

## Usage

```javascript
const sandbox = await Sandybox.create();
const sandboxedFunction = await sandbox.addFunction((word, repeat) => {
  let result = '';
  for (let i = 0; i < repeat; i++) result += word;
  return result;
});

console.log(await sandboxedFunction('hi!', 100000000));
```

### Cleanup

If you're finished with a function and worried about memory usage, you can use `sandbox.removeFunction(fn)` to evict the function from the sandbox.

```javascript
sandbox.removeFunction(sandboxedFunction);
```

Calling this will cause any unresolved executions of the function to reject. Additionally, once a function has been "removed" any calls to it will result in a rejected promise.

Similarly, if you are finished with a sandbox you can cleanup the entire thing by calling `sandbox.cleanup()`. This will remove all functions, the iframe, and the web worker.

```javascript
sandbox.cleanup();
```

In the future, sandboxes and their functions will likely cleanup automatically by using a [FinalizationRegistry](https://github.com/tc39/proposal-weakrefs). Until then, you'll need to manually cleanup if memory usage is a concern.

## Todo

1. Write tests
2. Implement test script
