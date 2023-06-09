import Sandbox from '@atom-web/sandbox';
import { any2AnyArray } from './utils';
import { parseUrlAssets, appendCSS } from './modules';

/**
 * CustomEvent Polyfill for IE.
 * See https://gist.github.com/gt3/787767e8cbf0451716a189cdcb2a0d08.
 */
(function () {
  if (typeof (window as any).CustomEvent === 'function') return false;

  function CustomEvent(event, params) {
    params = params || { bubbles: false, cancelable: false, detail: null };
    const evt = document.createEvent('CustomEvent');
    evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
    return evt;
  }

  (window as any).CustomEvent = CustomEvent;
})();

export interface RuntimeInstance {
  id: string;
  url: string;
}

type CombineRuntime = Pick<RuntimeInstance, 'id'> & { url?: string | string[] };

export type Runtime = boolean | string | RuntimeInstance[];

export type AssetState = 'INIT' | 'LOADING' | 'LOAD_ERROR' | 'LOADED';

interface Json<T> {
  [id: string]: T;
}

interface RuntimeCache {
  deps: object;
  state: AssetState;
}

const runtimeCache: Json<RuntimeCache> = {};

/**
 * excute one or multi runtime in serial.
 */
export function execute(codes: string | string[], deps: object, sandbox = new Sandbox({ multiMode: true }) as Sandbox) {
  sandbox.createProxySandbox(deps);

  any2AnyArray(codes).forEach((code) => sandbox.execScriptInSandbox(code));

  const addedProperties = sandbox.getAddedProperties();
  sandbox.clear();
  return addedProperties;
}

export function updateRuntimeState(mark: string, state: AssetState) {
  if (!runtimeCache[mark]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runtimeCache[mark] = {} as any;
  }
  runtimeCache[mark].state = state;
}

/**
 * fetch, excute then cache runtime info.
 */
export async function cacheDeps(runtime: CombineRuntime, deps: object, fetch = window.fetch) {
  const { id, url } = runtime;
  const mark = id;

  if (runtimeCache[mark]?.state === 'LOADING') {
    // await util resource loaded or error
    await new Promise((resolve) => window.addEventListener(mark, resolve));
  }

  if (runtimeCache[mark]?.state === 'LOADED') {
    return runtimeCache[mark]?.deps;
  }

  updateRuntimeState(mark, 'LOADING');

  const { cssList, jsList } = parseUrlAssets(url);

  // append css
  Promise.all(cssList.map((css: string) => appendCSS(`runtime-${id}`, css)));

  // execute in sandbox
  try {
    runtimeCache[mark].deps = await Promise.all(jsList.map((u) => fetch(u).then((res) => res.text()))).then((codes) =>
      execute(codes, deps),
    );

    updateRuntimeState(mark, 'LOADED');
    window.dispatchEvent(new CustomEvent(mark, { detail: { state: 'LOADED' } }));

    return runtimeCache[mark].deps;
  } catch (e) {
    updateRuntimeState(mark, 'LOAD_ERROR');
    window.dispatchEvent(new CustomEvent(mark, { detail: { state: 'LOAD_ERROR' } }));
    console.error(`[MicroModule] ${id} fetch or excute js assets error`, e);
    return Promise.reject(e);
  }
}

export function fetchRuntimeJson(url: string, fetch = window.fetch) {
  if (!/.json/.test(url)) {
    console.warn('[MicroModule] runtime url should be a json file.');
  }
  return fetch(url).then((res) => res.json());
}

export async function parseImmediately(runtimes: RuntimeInstance[], fetch = window.fetch) {
  return await runtimes.reduce(async (pre, next) => {
    const preProps = await pre;
    return {
      ...preProps,
      ...(await cacheDeps(next, preProps, fetch)),
    };
  }, Promise.resolve({}));
}

export async function parseRuntime(runtime: Runtime, fetch = window.fetch) {
  // if runtime is `undefined`/`false`
  if (!runtime) {
    return null;
  }

  /*
   * runtime info provided by url.
   */
  if (typeof runtime === 'string') {
    const runtimeConfigs = await fetchRuntimeJson(runtime, fetch);
    return parseImmediately(runtimeConfigs);
  }

  /*
   * runtime info provided in detail.
   */
  if (Array.isArray(runtime)) {
    return parseImmediately(runtime);
  }
}
