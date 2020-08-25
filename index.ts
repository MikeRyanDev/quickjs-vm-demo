import { getQuickJS, QuickJSHandle } from "quickjs-emscripten";
import chalk from "chalk";

async function main() {
  const QuickJS = await getQuickJS();
  const vm = QuickJS.createVm();

  /**
   * -------------------------------------------------
   * Set up a `console` object that the script can use
   * for simple debugging
   */
  const consoleHandler = vm.newObject();
  vm.setProp(vm.global, "console", consoleHandler);

  const consoleLogHandler = vm.newFunction(
    "log",
    (...messages: QuickJSHandle[]) => {
      const strings = messages.map((message) => vm.getString(message));
      console.log(chalk.blue("VM:"), ...strings);
    }
  );
  vm.setProp(consoleHandler, "log", consoleLogHandler);

  const consoleErrorHandler = vm.newFunction(
    "error",
    (...messages: QuickJSHandle[]) => {
      const strings = messages.map((message) => vm.getString(message));
      console.error(chalk.red("VM:"), ...strings);
    }
  );
  vm.setProp(consoleHandler, "error", consoleErrorHandler);

  consoleLogHandler.dispose();
  consoleErrorHandler.dispose();
  consoleHandler.dispose();

  /**
   * -------------------------------------------------------------
   * Utility function that enables the script in the VM to transmit
   * a serializable object up to the host
   */
  const getObject = (object: QuickJSHandle) => {
    const JSONhandler = vm.getProp(vm.global, "JSON");
    const stringifyHandler = vm.getProp(JSONhandler, "stringify");
    const stringifiedResultHanler = vm.unwrapResult(
      vm.callFunction(stringifyHandler, JSONhandler, object)
    );

    const unparsedResult = vm.getString(stringifiedResultHanler);

    JSONhandler.dispose();
    stringifyHandler.dispose();
    stringifiedResultHanler.dispose();

    return JSON.parse(unparsedResult);
  };

  /**
   * -------------------------------------------------------------
   * Sets up an event listeners registry so that anyone in the VM
   * can listen to messages being sent from the host
   */
  const listeners = vm.newArray();
  const listenHandler = vm.newFunction("listen", (_callback: QuickJSHandle) => {
    // QuickJS eagerly disposes of function arguments.
    // Putting it in a box keeps it around.
    const boxHandler = vm.newObject();
    const lengthHandler = vm.getProp(listeners, "length");

    vm.setProp(listeners, lengthHandler, _callback);
    vm.setProp(boxHandler, "value", _callback);

    lengthHandler.dispose();

    const unlisten = vm.newFunction("unlisten", () => {
      const indexOfHandler = vm.getProp(listeners, "indexOf");
      const spliceHandler = vm.getProp(listeners, "splice");
      const callbackHandler = vm.getProp(boxHandler, "value");

      const indexOfCallbackFnHandler = vm.unwrapResult(
        vm.callFunction(indexOfHandler, listeners, callbackHandler)
      );
      const oneHandler = vm.newNumber(1);
      const resultOfSpliceHandler = vm.unwrapResult(
        vm.callFunction(
          spliceHandler,
          listeners,
          indexOfCallbackFnHandler,
          oneHandler
        )
      );

      boxHandler.dispose();
      indexOfHandler.dispose();
      spliceHandler.dispose();
      callbackHandler.dispose();
      indexOfCallbackFnHandler.dispose();
      oneHandler.dispose();
      resultOfSpliceHandler.dispose();
    });

    return unlisten;
  });
  vm.setProp(vm.global, "listen", listenHandler);
  listenHandler.dispose();

  /**
   * -------------------------------------------------------------
   * This notify chain serializes a message from the host and
   * broadcasts it to every listener inside of the VM
   */
  const notifyHandler = vm.newFunction(
    "notify",
    (messageStr: QuickJSHandle) => {
      const JSONHandler = vm.getProp(vm.global, "JSON");
      const parseHandler = vm.getProp(JSONHandler, "parse");
      const messageHandler = vm.unwrapResult(
        vm.callFunction(parseHandler, JSONHandler, messageStr)
      );
      const forEachHandler = vm.getProp(listeners, "forEach");

      const forEachCallbackHandler = vm.newFunction(
        "forEachCallback",
        (callbackHandler: QuickJSHandle) => {
          const resultHandler = vm.unwrapResult(
            vm.callFunction(callbackHandler, vm.global, messageHandler)
          );

          resultHandler.dispose();
        }
      );

      const resultHandler = vm.unwrapResult(
        vm.callFunction(forEachHandler, listeners, forEachCallbackHandler)
      );

      JSONHandler.dispose();
      parseHandler.dispose();
      messageHandler.dispose();
      forEachHandler.dispose();
      forEachCallbackHandler.dispose();
      resultHandler.dispose();
    }
  );
  function notify(message: object) {
    const resultHandler = vm.unwrapResult(
      vm.callFunction(
        notifyHandler,
        vm.global,
        vm.newString(JSON.stringify(message))
      )
    );

    vm.executePendingJobs();

    resultHandler.dispose();
  }

  /**
   * -------------------------------------------------------------
   * Proof-of-concept showing communication going from the VM
   * up to the host
   */
  const transmitHandler = vm.newFunction(
    "transmit",
    (object: QuickJSHandle) => {
      console.log(getObject(object));
    }
  );
  vm.setProp(vm.global, "transmit", transmitHandler);
  transmitHandler.dispose();

  /**
   * -------------------------------------------------------------
   * The actual script being run in the VM
   */
  const result = vm.evalCode(`
    let i = 0;
    const unlisten = listen(message => {
      console.log(message.type);
      console.log(++i);

      if (i > 3) {
        unlisten();
      }
    });

    async function main() {
      const value = await new Promise(resolve => {
        const unlisten = listen(message => {
          if (message.type === "enough of it?") {
            resolve(123);

            unlisten();
          }
        })
      })

      console.log('RESOLVED', value);

      transmit({
        complex: {
          object: {
            with: {
              values: 123,
              set: ['a', {}, 'b']
            }
          }
        }
      })
    }

    main();
  `);

  if (result.error) {
    console.error(vm.dump(result.error));
  }

  notify({ type: "first message" });
  notify({ type: "second" });
  notify({ type: "third message" });
  notify({ type: "fourth message" });
  notify({ type: "fifth message" });
  notify({ type: "sixth message" });
}

main().catch(console.error);
