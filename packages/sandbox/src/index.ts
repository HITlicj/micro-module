import { getNewDocument } from './append';

export interface SandboxProps {
  multiMode?: boolean;
  name?: string;
  key?: string;
  container?: HTMLElement;
  scopedCSS?: boolean;
}

export type SandboxConstructor = new () => Sandbox;

const CONSTRUCTOR_LIST = [
  'Array',
  'Object',
  'String',
  'Boolean',
  'Function',
  'Date',
  'Proxy',
  'Set',
  'Map',
  'Symbol',
  'Promise',
  'RegExp',
  'WeakMap',
  'WeakSet',
  'Error',
  'HTMLElement',
  'HTMLIFrameElement',
];
const NON_CONSTRUCTOR_LIST = [
  'isNaN',
  'parseInt',
  'parseFloat',
  'isFinite',
  'encodeURIComponent',
  'decodeURIComponent',
];

// check window constructor function， like Object Array
function isConstructor(fn: any) {
  // 因涉及大量调用，在此设置快捷判断
  if (CONSTRUCTOR_LIST.includes(fn.name)) {
    return true;
  }
  if (NON_CONSTRUCTOR_LIST.includes(fn.name) || fn.name === 'clearTimeout') {
    return false;
  }
  // generator function and has own prototype properties
  const hasConstructor =
    fn.prototype &&
    fn.prototype.constructor === fn &&
    Object.getOwnPropertyNames(fn.prototype).length > 1;
  // unnecessary to call toString if it has constructor function
  const functionStr = !hasConstructor && fn.toString();
  const upperCaseRegex = /^function\s+[A-Z]/;

  return (
    hasConstructor ||
    // upper case
    upperCaseRegex.test(functionStr) ||
    // ES6 class, window function do not have this case
    functionStr.slice(0, 5) === 'class'
  );
}

// get function from original window, such as scrollTo, parseInt
function isNormalFunction(func: any, noWin?: boolean) {
  return func && typeof func === 'function' && (noWin || !isConstructor(func));
}

export function getValueByHandleFunc(value: any, context: any, noWin?: boolean) {
  if (isNormalFunction(value, noWin)) {
    // When run into some window's functions, such as `console.table`,
    // an illegal invocation exception is thrown.
    const boundValue = value.bind(context);

    // Axios, Moment, and other callable functions may have additional properties.
    // Simply copy them into boundValue.
    for (const key in value) {
      boundValue[key] = value[key];
    }

    return boundValue;
  }
  // case of window.clientWidth、new window.Object()
  return value;
}

export default class Sandbox {
  private name = '';

  private key;

  private scopedCSS = true;

  private container: HTMLElement;

  private sandbox: Window | null;

  private multiMode: boolean | undefined = false;

  private eventListeners: Record<string, any> = {};

  private timeoutIds: number[] = [];

  private intervalIds: number[] = [];

  private propertyAdded: Record<PropertyKey, any> = {};

  private originalValues: Record<PropertyKey, any> = {};

  sandboxDisabled = false;

  constructor(props: SandboxProps = {}) {
    const { multiMode = true, name, key, container, scopedCSS } = props;
    if (!window.Proxy) {
      console.warn('proxy sandbox is not support by current browser');
      this.sandboxDisabled = true;
    }
    // enable multiMode in case of create mulit sandbox in same time
    this.multiMode = multiMode;
    this.sandbox = null;
    this.scopedCSS = scopedCSS !== false;
    if (name) {
      this.name = name;
      container?.classList.add(name);
    }
    this.key = key;
    this.container = container || document.body;
  }

  createProxySandbox(injection?: object) {
    const { propertyAdded, originalValues, multiMode } = this;
    const proxyWindow = Object.create(null);
    const originalWindow = window;
    // 快速读取，提升性能
    const originalObject = window.Object;
    const originalArray = window.Array;
    const quickList = [...CONSTRUCTOR_LIST, ...NON_CONSTRUCTOR_LIST];
    const originalAttr = quickList.reduce<Record<string, any>>((p, c) => {
      p[c] = (window as any)[c];
      return p;
    }, {});
    const originalAddEventListener = window.addEventListener;
    const originalRemoveEventListener = window.removeEventListener;
    const originalSetInterval = window.setInterval;
    const originalSetTimeout = window.setTimeout;

    // hijack addEventListener
    proxyWindow.addEventListener = (eventName: string, fn: any, ...rest: any) => {
      this.eventListeners[eventName] = this.eventListeners[eventName] || [];
      this.eventListeners[eventName].push(fn);

      return originalAddEventListener.apply(originalWindow, [eventName, fn, ...rest]);
    };
    // hijack removeEventListener
    proxyWindow.removeEventListener = (eventName: string, fn: any, ...rest: any) => {
      const listeners = this.eventListeners[eventName] || [];
      if (listeners.includes(fn)) {
        listeners.splice(listeners.indexOf(fn), 1);
      }
      return originalRemoveEventListener.apply(originalWindow, [eventName, fn, ...rest]);
    };
    // hijack setTimeout
    proxyWindow.setTimeout = (...args: Parameters<Window['setTimeout']>) => {
      const timerId = originalSetTimeout(...args);
      this.timeoutIds.push(timerId);
      return timerId;
    };
    // hijack setInterval
    proxyWindow.setInterval = (...args: Parameters<Window['setInterval']>) => {
      const intervalId = originalSetInterval(...args);
      this.intervalIds.push(intervalId);
      return intervalId;
    };

    proxyWindow.document = getNewDocument({
      originalWindow,
      name: this.name,
      key: this.key,
      container: this.container,
      scopedCSS: this.scopedCSS,
    });

    const sandbox = new Proxy(proxyWindow, {
      set(target: Window, p: PropertyKey, value: any): boolean {
        // eslint-disable-next-line no-prototype-builtins
        if (!originalWindow.hasOwnProperty(p)) {
          // record value added in sandbox
          propertyAdded[p] = value;
        } else if (!originalValues.hasOwnProperty(p)) {
          // if it is already been setted in original window, record it's original value
          originalValues[p] = originalWindow[p];
        }
        // set new value to original window in case of jsonp, js bundle which will be execute outof sandbox
        if (!multiMode) {
          originalWindow[p] = value;
        }
        target[p] = value;
        return true;
      },
      get(target: Window, p: PropertyKey): any {
        if (p === Symbol.unscopables) {
          // eslint-disable-next-line no-undefined
          return undefined;
        }
        if (['top', 'window', 'self', 'globalThis'].includes(p as string)) {
          return sandbox;
        }
        // proxy hasOwnProperty, in case of proxy.hasOwnProperty value represented as originalWindow.hasOwnProperty
        if (p === 'hasOwnProperty') {
          // eslint-disable-next-line no-prototype-builtins
          return (key: PropertyKey) => !!target[key as any] || originalWindow.hasOwnProperty(key);
        }

        const targetValue = target[p as any];

        /**
         * Falsy value like 0/ ''/ false should be trapped by proxy window.
         */
        // eslint-disable-next-line no-undefined
        if (targetValue !== undefined) {
          // case of addEventListener, removeEventListener, setTimeout, setInterval setted in sandbox
          return targetValue;
        }

        // search from injection
        const injectionValue = (injection as any)?.[p];
        if (injectionValue) {
          return injectionValue;
        }

        if (p === 'Object') {
          return originalObject;
        }

        if (p === 'Array') {
          return originalArray;
        }

        if (quickList.includes(String(p))) {
          return originalAttr[String(p)];
        }

        const value = originalWindow[p as any];

        /**
         * use `eval` indirectly if you bind it. And if eval code is not being evaluated by a direct call,
         * then initialise the execution context as if it was a global execution context.
         * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval
         * https://262.ecma-international.org/5.1/#sec-10.4.2
         */
        if (p === 'eval') {
          return value;
        }

        return getValueByHandleFunc(value, originalWindow);
      },
      has(target: Window, p: PropertyKey): boolean {
        if (p === 'Object' || p === 'Array' || quickList.includes(String(p))) {
          return true;
        }
        return p in target || p in originalWindow;
      },
    }) as Window;
    this.sandbox = sandbox;
  }

  getSandbox() {
    return this.sandbox;
  }

  getAddedProperties() {
    return this.propertyAdded;
  }

  execScriptInSandbox(script: string): void {
    if (!this.sandboxDisabled) {
      // create sandbox before exec script
      if (!this.sandbox) {
        this.createProxySandbox();
      }
      try {
        let code = new Function('sandbox', `with (sandbox) {self=this;${script}\n}`).bind(
          this.sandbox
        );
        // run code with sandbox
        code(this.sandbox);
        code = null;
      } catch (error) {
        console.error(`error occurs when execute script in sandbox: ${error}`);
        throw error;
      }
    }
  }

  clear() {
    if (!this.sandboxDisabled) {
      // remove event listeners
      Object.keys(this.eventListeners).forEach((eventName) => {
        (this.eventListeners[eventName] || []).forEach((listener: any) => {
          window.removeEventListener(eventName, listener);
        });
      });
      // clear timeout
      this.timeoutIds.forEach((id) => window.clearTimeout(id));
      this.intervalIds.forEach((id) => window.clearInterval(id));
      // recover original values
      Object.keys(this.originalValues).forEach((key) => {
        window[key as any] = this.originalValues[key];
      });
      // @IMP 暂时注释下列，沙箱单实例下会有问题
      // Object.keys(this.propertyAdded).forEach(key => {
      //     // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      //     delete window[key as any];
      // });
      this.sandbox = null;
      this.originalValues = [];
    }
  }
}
