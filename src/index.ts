/**
 * TYPES
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any) => any;

type SandboxedFunction<T extends AnyFunction> = (
  ...args: Parameters<T>
) => Promise<ReturnType<T>>;

export interface Sandbox {
  addFunction(
    fn: string
  ): Promise<SandboxedFunction<(...args: unknown[]) => unknown>>;
  addFunction<T extends AnyFunction>(fn: T): Promise<SandboxedFunction<T>>;
  removeFunction(fn: SandboxedFunction<AnyFunction>): void;
  cleanup(): void;
}

interface SandboxOptions {
  dangerouslyAllowSameOrigin?: boolean;
}

type ResolveOrReject = {
  resolve: (result?: unknown) => void;
  reject: (reason: Error) => void;
};

type ExecutionRecord = {
  [executionId: string]: ResolveOrReject;
};

// These are messages that get sent from the main thread to the worker
type MessageToWorker =
  | {
      type: 'cf'; // create-function
      code: string;
      fid: number;
    }
  | {
      type: 'ef'; // execute-function
      args: unknown[];
      fid: number;
      executionId: number;
    }
  | {
      type: 'rf'; // remove-function
      fid: number;
    };

// These are messages that get sent from the worker to the main thread
type MessageFromWorker =
  | {
      type: 'sr'; // sandbox-ready
      fid: never;
    }
  | {
      type: 'fr'; // function-ready
      fid: number;
    }
  | {
      type: 'rse'; // resolve-execution
      fid: number;
      executionId: number;
      result: unknown;
    }
  | {
      type: 'ree'; // reject-execution
      fid: number;
      executionId: number;
      message: string;
    }
  | {
      type: 'cfe'; // create-function-error
      fid: number;
      message: string;
    };

// These are messages that get sent from the main thread to the iframe
// and then forwarded to the web worker
type MessageToIFrame = {
  type: 'p'; // port
};

/**
 * IMPLEMENTATION
 */

export class SandboxError extends Error {
  constructor(...args: string[]) {
    super(...args);
    this.name = 'SandboxError';
  }
}

function iframeCode() {
  const worker = new Worker(createWorkerCode());

  self.onmessage = (message: MessageEvent<MessageToIFrame>) => {
    if (message.data.type === 'p')
      worker.postMessage({ type: 'p' }, [message.ports[0]]);
  };

  function createWorkerCode() {
    const code = `(${workerCode})();`;
    const blob = new Blob([code], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
  }

  function workerCode() {
    const evalCode = (code: string) => {
      return eval(`const functions = null;(${code})`);
    };

    const functions: {
      [fid: number]: (...args: unknown[]) => unknown;
    } = {};

    const createFunction = (fid: number, code: string): MessageFromWorker => {
      try {
        functions[fid] = evalCode(code);
        return {
          type: 'fr',
          fid: fid,
        };
      } catch (e) {
        return {
          type: 'cfe',
          fid: fid,
          message: e.message,
        };
      }
    };

    const executeFunction = async (
      fid: number,
      executionId: number,
      args: unknown[]
    ): Promise<MessageFromWorker> => {
      try {
        const result = await functions[fid](...args);
        return {
          type: 'rse',
          result,
          fid: fid,
          executionId: executionId,
        };
      } catch (e) {
        return {
          type: 'ree',
          message: e.message,
          fid: fid,
          executionId: executionId,
        };
      }
    };

    const removeFunction = (fid: number) => {
      delete functions[fid];
    };

    async function handleMessage(
      this: MessagePort,
      message: MessageEvent<MessageToWorker>
    ) {
      const { data } = message;
      switch (data.type) {
        case 'cf':
          this.postMessage(await createFunction(data.fid, data.code));
          break;
        case 'ef': // execute
          this.postMessage(
            await executeFunction(data.fid, data.executionId, data.args)
          );
          break;
        case 'rf':
          removeFunction(data.fid);
          break;
      }
    }

    self.onmessage = (message: MessageEvent<MessageToIFrame>) => {
      if (message.data.type === 'p') {
        const port = message.ports[0];
        port.postMessage({ type: 'sr' });
        port.onmessage = handleMessage;
      }
    };
  }
}

function createIFrameSrc(): string {
  const code = `<script>(${iframeCode})();</script>`;
  const blob = new Blob([code], { type: 'text/html' });
  return URL.createObjectURL(blob);
}

const createIFrame = ({
  dangerouslyAllowSameOrigin,
}: SandboxOptions): HTMLIFrameElement => {
  const iframe = document.createElement('iframe');
  iframe.classList.add('sandybox');
  const sandboxAttr = ['allow-scripts'];
  if (dangerouslyAllowSameOrigin) sandboxAttr.push('allow-same-origin');
  iframe.setAttribute('sandbox', sandboxAttr.join(' '));
  iframe.style.display = 'none';
  iframe.src = createIFrameSrc();
  document.body.appendChild(iframe);
  return iframe;
};

const postMessageToWorker = (
  portToWorker: MessagePort,
  message: MessageToWorker
) => {
  portToWorker.postMessage(message);
};

const createSandbox = (iframe: HTMLIFrameElement): Promise<Sandbox> =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    const portFromWorker = channel.port2;

    // The contentWindow should definitely be set since we wait for onload
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    iframe.contentWindow!.postMessage({ type: 'p' }, '*', [portFromWorker]);

    let fidCounter = 0;
    const functionInitializations = new Map<number, ResolveOrReject>();
    const functionExecutions = new Map<number, ExecutionRecord>();
    const functions = new Map<SandboxedFunction<AnyFunction>, number>();

    const portToWorker = channel.port1;

    let isCleanedUp = false;
    const sandbox = {
      async addFunction<T extends AnyFunction>(fn: T | string) {
        if (isCleanedUp) throw new SandboxError('Sandbox has been cleaned up.');

        const fid = ++fidCounter;

        let executionId = 0;
        functionExecutions.set(fid, {});
        const sandboxedFunction = (...args: unknown[]) =>
          new Promise((resolve, reject) => {
            const executions = functionExecutions.get(fid);

            if (!executions)
              return reject(
                new SandboxError('Function has been removed from sandbox.')
              );

            executionId += 1;
            executions[executionId] = { resolve, reject };
            postMessageToWorker(portToWorker, {
              type: 'ef',
              args,
              fid,
              executionId,
            });
          });

        functions.set(sandboxedFunction, fid);

        return new Promise<typeof sandboxedFunction>((resolve, reject) => {
          functionInitializations.set(fid, {
            resolve: () => resolve(sandboxedFunction),
            reject,
          });

          postMessageToWorker(portToWorker, {
            type: 'cf',
            code: fn.toString(),
            fid,
          });
        });
      },

      removeFunction(fn: AnyFunction) {
        if (isCleanedUp) return;

        const fid = functions.get(fn);
        if (fid) {
          postMessageToWorker(portToWorker, {
            type: 'rf',
            fid,
          });

          functions.delete(fn);
          const executions = functionExecutions.get(fid);
          if (executions) {
            functionExecutions.delete(fid);
            Object.entries(executions).forEach(([key, { reject }]) => {
              delete executions[key];
              reject(
                new SandboxError('Function has been removed from sandbox.')
              );
            });
          }
        }
      },

      cleanup() {
        if (isCleanedUp) return;

        const fnInits = functionInitializations.values();
        for (const fn of fnInits)
          fn.reject(new SandboxError('Sandbox has been cleaned up.'));

        const fns = functions.keys();
        for (const fn of fns) this.removeFunction(fn);
        isCleanedUp = true;

        iframe.remove();
      },
    };

    portToWorker.onmessage = (message: MessageEvent<MessageFromWorker>) => {
      const { data } = message;
      if (data.type === 'sr') {
        resolve(sandbox);
      } else {
        if (data.type === 'cfe' || data.type === 'fr') {
          const resolveOrReject = functionInitializations.get(data.fid);
          if (!resolveOrReject) return;
          if (data.type === 'fr') {
            resolveOrReject.resolve();
          } else {
            resolveOrReject.reject(new Error(data.message));
          }
          functionInitializations.delete(data.fid);
        }

        const executions = functionExecutions.get(data.fid);
        if (!executions) return;
        if (data.type === 'rse') {
          executions[data.executionId].resolve(data.result);
        } else if (data.type === 'ree') {
          executions[data.executionId].reject(new Error(data.message));
        }
      }
    };
  });

const Sandybox = {
  create: (options: SandboxOptions = {}): Promise<Sandbox> =>
    new Promise((resolve) => {
      const iframe = createIFrame(options);
      iframe.onload = async () => {
        const sandbox = await createSandbox(iframe);
        resolve(sandbox);
      };
    }),
};

export default Sandybox;
