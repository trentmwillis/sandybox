type AnyFunction = (...args: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

type SandboxedFunction<T extends AnyFunction> = (
  ...args: Parameters<T>
) => Promise<ReturnType<T>>;

interface Sandbox {
  addFunction(
    fn: string
  ): Promise<SandboxedFunction<(...args: unknown[]) => unknown>>;
  addFunction<T extends AnyFunction>(fn: T): Promise<SandboxedFunction<T>>;
  removeFunction(fn: SandboxedFunction<AnyFunction>): void;
  cleanup(): void;
}

type ExecutionRecord = {
  [executionId: string]: {
    resolve: (result: unknown) => void;
    reject: (reason: Error) => void;
  };
};

type MessageToWorker =
  | {
      type: 'create-function';
      code: string;
      functionId: number;
    }
  | {
      type: 'execute';
      args: unknown[];
      functionId: number;
      executionId: number;
    };

type MessageFromWorker =
  | {
      type: 'sandbox-ready';
      functionId: never;
    }
  | {
      type: 'ready';
      functionId: number;
    }
  | {
      type: 'resolve';
      functionId: number;
      executionId: number;
      result: unknown;
    }
  | {
      type: 'reject';
      functionId: number;
      executionId: number;
      message: string;
    }
  | {
      type: 'error';
      functionId: number;
      message: string;
    };

type MessageToIFrame = {
  type: 'port';
};

function iframeCode() {
  const worker = new Worker(createWorkerCode());

  self.onmessage = (message: MessageEvent<MessageToIFrame>) => {
    if (message.data.type === 'port') {
      worker.postMessage({ type: 'port' }, [message.ports[0]]);
    }
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
      [functionId: number]: (...args: unknown[]) => unknown;
    } = {};

    self.onmessage = (message: MessageEvent<MessageToIFrame>) => {
      if (message.data.type === 'port') {
        message.ports[0].postMessage({ type: 'sandbox-ready' });
        message.ports[0].onmessage = async (
          portMessage: MessageEvent<MessageToWorker>
        ) => {
          if (portMessage.data.type === 'create-function') {
            try {
              functions[portMessage.data.functionId] = evalCode(
                portMessage.data.code
              );
            } catch (e) {
              message.ports[0].postMessage({
                type: 'error',
                functionId: portMessage.data.functionId,
                message: e.message,
              });
            }
            message.ports[0].postMessage({
              type: 'ready',
              functionId: portMessage.data.functionId,
            });
          } else if (portMessage.data.type === 'execute') {
            const result = await functions[portMessage.data.functionId](
              ...portMessage.data.args
            );
            message.ports[0].postMessage({
              type: 'resolve',
              result,
              functionId: portMessage.data.functionId,
              executionId: portMessage.data.executionId,
            });
          }
        };
      }
    };
  }
}

function createIFrameSrc(): string {
  const code = `(${iframeCode})();`;
  const html = `<script>${code}</script>`;
  const blob = new Blob([html], { type: 'text/html' });
  return URL.createObjectURL(blob);
}

const createIFrame = (): HTMLIFrameElement => {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
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
    const { contentWindow } = iframe;
    if (!contentWindow) throw new Error('');
    contentWindow.postMessage({ type: 'port' }, '*', [portFromWorker]);

    let functionIdCounter = 0;
    const functionExecutions = new Map<number, ExecutionRecord>();
    const functions = new Map<SandboxedFunction<AnyFunction>, number>();
    const functionInitializations = new Map<number, AnyFunction>();

    const portToWorker = channel.port1;

    let isCleanedUp = false;
    const sandbox = {
      async addFunction<T extends AnyFunction>(fn: T | string) {
        if (isCleanedUp) throw new Error('Sandbox has been cleaned up.');

        const functionId = ++functionIdCounter;

        functionExecutions.set(functionId, {});

        let executionId = 0;

        const sandboxedFunction = (...args: unknown[]) =>
          new Promise((resolve, reject) => {
            const executions = functionExecutions.get(functionId);

            if (!executions)
              return reject(
                new Error('Function has been removed from sandbox.')
              );

            executionId += 1;
            executions[executionId] = { resolve, reject };
            postMessageToWorker(portToWorker, {
              type: 'execute',
              args,
              functionId,
              executionId,
            });
          });

        functions.set(sandboxedFunction, functionId);

        return new Promise<typeof sandboxedFunction>((resolve, reject) => {
          const resolveHandler = (message: MessageEvent<MessageFromWorker>) => {
            if (message.data.type === 'error') {
              reject(new Error(message.data.message));
            } else if (message.data.type === 'ready') {
              resolve(sandboxedFunction);
            }
          };

          functionInitializations.set(functionId, resolveHandler);

          postMessageToWorker(portToWorker, {
            type: 'create-function',
            code: fn.toString(),
            functionId,
          });
        });
      },

      removeFunction(fn: AnyFunction) {
        if (isCleanedUp) return;

        const id = functions.get(fn);
        if (id) {
          functions.delete(fn);
          const executions = functionExecutions.get(id);
          if (executions) {
            functionExecutions.delete(id);
            Object.entries(executions).forEach(([key, { reject }]) => {
              delete executions[key];
              reject(new Error('Function has been removed from sandbox.'));
            });
          }
        }
      },

      cleanup() {
        if (isCleanedUp) return;

        const fns = functions.keys();
        for (const fn of fns) this.removeFunction(fn);
        isCleanedUp = true;

        iframe.remove();
      },
    };

    portToWorker.addEventListener(
      'message',
      (message: MessageEvent<MessageFromWorker>) => {
        if (message.data.type === 'sandbox-ready') {
          resolve(sandbox);
        } else {
          if (message.data.type === 'error' || message.data.type === 'ready') {
            const resolver = functionInitializations.get(
              message.data.functionId
            );
            if (!resolver) return;
            resolver(message);
            functionInitializations.delete(message.data.functionId);
          }

          const executions = functionExecutions.get(message.data.functionId);
          if (!executions) return;
          if (message.data.type === 'resolve') {
            executions[message.data.executionId].resolve(message.data.result);
          } else if (message.data.type === 'reject') {
            executions[message.data.executionId].reject(
              new Error(message.data.message)
            );
          }
        }
      }
    );

    portToWorker.start();
  });

const Sandybox = {
  create: (): Promise<Sandbox> =>
    new Promise((resolve) => {
      const iframe = createIFrame();
      iframe.onload = async () => {
        const sandbox = await createSandbox(iframe);
        resolve(sandbox);
      };
    }),
};

export default Sandybox;
