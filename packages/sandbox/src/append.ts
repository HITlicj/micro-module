/**
 * 拦截appendChild，当前只操作head中添加的css
 */
import * as css from './css';
import { getValueByHandleFunc } from './index';

const SCRIPT_TAG_NAME = 'SCRIPT';
const LINK_TAG_NAME = 'LINK';
const STYLE_TAG_NAME = 'STYLE';

export const styleElementTargetSymbol = Symbol('target');
const dynamicLinkAttachedInlineStyleMap = new WeakMap<HTMLLinkElement, HTMLStyleElement>();

type DynamicDomMutationTarget = 'head' | 'body';

declare global {
  interface HTMLLinkElement {
    [styleElementTargetSymbol]: DynamicDomMutationTarget;
  }

  interface HTMLStyleElement {
    [styleElementTargetSymbol]: DynamicDomMutationTarget;
  }
}

export function isHijackingTag(tagName?: string) {
  return (
    tagName?.toUpperCase() === LINK_TAG_NAME ||
    tagName?.toUpperCase() === STYLE_TAG_NAME ||
    tagName?.toUpperCase() === SCRIPT_TAG_NAME
  );
}

function patchCustomEvent(
  e: CustomEvent,
  elementGetter: () => HTMLScriptElement | HTMLLinkElement | null
): CustomEvent {
  Object.defineProperties(e, {
    srcElement: {
      get: elementGetter,
    },
    target: {
      get: elementGetter,
    },
  });

  return e;
}

function manualInvokeElementOnLoad(element: HTMLLinkElement | HTMLScriptElement) {
  // we need to invoke the onload event manually to notify the event listener that the script was completed
  // here are the two typical ways of dynamic script loading
  // 1. element.onload callback way, which webpack and loadjs used, see https://github.com/muicss/loadjs/blob/master/src/loadjs.js#L138
  // 2. addEventListener way, which toast-loader used, see https://github.com/pyrsmk/toast/blob/master/src/Toast.ts#L64
  const loadEvent = new CustomEvent('load');
  const patchedEvent = patchCustomEvent(loadEvent, () => element);
  if (typeof element.onload === 'function') {
    element.onload(patchedEvent);
  } else {
    element.dispatchEvent(patchedEvent);
  }
}

function manualInvokeElementOnError(element: HTMLLinkElement | HTMLScriptElement) {
  const errorEvent = new CustomEvent('error');
  const patchedEvent = patchCustomEvent(errorEvent, () => element);
  if (typeof element.onerror === 'function') {
    element.onerror(patchedEvent);
  } else {
    element.dispatchEvent(patchedEvent);
  }
}

function convertLinkAsStyle(
  name: string,
  element: HTMLLinkElement,
  postProcess: (styleElement: HTMLStyleElement) => void,
  fetchFn = fetch
): HTMLStyleElement {
  const styleElement = document.createElement('style');
  const { href } = element;
  // add source link element href
  styleElement.dataset.sandboxHref = href;
  styleElement.dataset.module = `sandbox-${name}`;

  fetchFn(href)
    .then((res: any) => res.text())
    .then((styleContext: string) => {
      postProcess(styleElement);
      styleElement.appendChild(document.createTextNode(styleContext));
      manualInvokeElementOnLoad(element);
    })
    .catch((e) => {
      manualInvokeElementOnError(element);
    });

  return styleElement;
}

function getOverwrittenAppendChildOrInsertBefore(opts: {
  rawDOMAppendOrInsertBefore: <T extends Node>(newChild: T, refChild: Node | null) => T;
  // target: DynamicDomMutationTarget;
  target: HTMLHeadElement | HTMLBodyElement;
  name: string;
  key: string;
  scopedCSS: boolean;
  container: HTMLElement;
  originalWindow: Window;
}) {
  return function appendChildOrInsertBefore<T extends Node>(
    this: HTMLHeadElement | HTMLBodyElement,
    newChild: T,
    refChild: Node | null = null
  ) {
    const element = newChild as any;
    const { rawDOMAppendOrInsertBefore, target, name, key, scopedCSS, originalWindow } = opts;
    element.setAttribute('data-module', `sandbox-${name}`);

    if (!isHijackingTag(element.tagName)) {
      // body中插入元素时代理到自定义元素中
      if (target instanceof HTMLBodyElement) {
        return rawDOMAppendOrInsertBefore.call(this, element, refChild);
      }
      return rawDOMAppendOrInsertBefore.call(target, element, refChild) as T;
    }

    if (element.tagName) {
      switch (element.tagName) {
        case LINK_TAG_NAME:
        case STYLE_TAG_NAME: {
          let stylesheetElement: HTMLLinkElement | HTMLStyleElement = newChild as any;
          // const { href } = stylesheetElement as HTMLLinkElement;
          // if (excludeAssetFilter && href && excludeAssetFilter(href)) {
          //     return rawDOMAppendOrInsertBefore.call(this, element, refChild) as T;
          // }

          Object.defineProperty(stylesheetElement, styleElementTargetSymbol, {
            value: target instanceof HTMLHeadElement ? 'head' : 'body',
            writable: true,
            configurable: true,
          });

          const appWrapper = target;

          if (scopedCSS) {
            // exclude link elements like <link rel="icon" href="favicon.ico">
            const linkElementUsingStylesheet =
              element.tagName?.toUpperCase() === LINK_TAG_NAME &&
              (element as HTMLLinkElement).rel === 'stylesheet' &&
              (element as HTMLLinkElement).href;
            if (linkElementUsingStylesheet) {
              stylesheetElement = convertLinkAsStyle(
                name,
                element,
                (styleElement) => css.process(appWrapper, styleElement, name),
                fetch
              );
              dynamicLinkAttachedInlineStyleMap.set(element, stylesheetElement);
            } else {
              css.process(appWrapper, stylesheetElement, name);
            }
          }

          const mountDOM = appWrapper;
          // target === 'head' ? getAppWrapperHeadElement(appWrapper) : appWrapper;

          // dynamicStyleSheetElements.push(stylesheetElement);
          const referenceNode = mountDOM.contains(refChild) ? refChild : null;
          return rawDOMAppendOrInsertBefore.call(mountDOM, stylesheetElement, referenceNode);
        }
        case SCRIPT_TAG_NAME: {
          // 所有实例绑定到全局变量
          const sandboxInstance = (originalWindow as any)[`sandboxInstance_${name}_${key}`];
          if (sandboxInstance) {
            const { src, text } = element as HTMLScriptElement;
            // some script like jsonp maybe not support cors which should't use execScripts
            // if ((excludeAssetFilter && src && excludeAssetFilter(src)) || !isExecutableScriptType(element)) {
            //     return rawDOMAppendOrInsertBefore.call(this, element, refChild) as T;
            // }

            if (src) {
              fetch(src)
                .then(async (res) => res.text())
                .then((data) => {
                  sandboxInstance.execScriptInSandbox(data);
                  manualInvokeElementOnLoad(element);
                })
                .catch((e) => {
                  manualInvokeElementOnError(element);
                });
              return;
            }
            sandboxInstance.execScriptInSandbox(text);
            return;
          }
          break;
        }
        default:
          break;
      }
    }

    return rawDOMAppendOrInsertBefore.call(target, element, refChild);
  };
}

// 设置后对原对象有影响 或 获取值为dom节点时
const DOCUMENT_IGNORE_KEY = [
  'innerText',
  'outerText',
  'innerHTML',
  'outerHTML',
  'textContent',
  'removeChild',
  'remove',
  'children',
  'childNodes',
  'firstElementChild',
  'lastElementChild',
  'previousElementSibling',
  'nextElementSibling',
  'parentNode',
  'parentElement',
  'firstChild',
  'lastChild',
  'previousSibling',
  'nextSibling',
  'offsetWidth',
  'offsetHeight',
  'offsetLeft',
  'offsetTop',
  'offsetParent',
  'scrollTop',
  'scrollLeft',
  'scrollWidth',
  'scrollHeight',
  'clientTop',
  'clientLeft',
  'clientWidth',
  'clientHeight',
  // Hourglass添加的属性
  '__sn',
  'tagName',
];

// eslint-disable-next-line max-lines-per-function
export const getNewDocument = (params: {
  originalWindow: Window;
  name: string;
  key?: string;
  container: HTMLElement;
  scopedCSS: boolean;
}) => {
  const { originalWindow, name, key: componentKey = '', container, scopedCSS } = params;
  ['head', 'body', 'document'].forEach((type) => {
    const elTag = `${type}-element-${name.toLowerCase()}-${componentKey}`;
    if (!customElements.get(elTag)) {
      const FakeEl = class extends HTMLElement {
        // eslint-disable-next-line @typescript-eslint/no-useless-constructor
        constructor() {
          super();
        }
      };
      customElements.define(elTag, FakeEl);
    }
  });
  const fakeEle: { head: HTMLElement | null; body: HTMLElement | null } = {
    head: null,
    body: null,
  };
  function getRewritedAppend(type: 'head' | 'body', componentKey: string, isInsert?: boolean) {
    const tarEl = type === 'head' ? originalWindow.document.head : originalWindow.document.body;
    const originFun = isInsert ? tarEl.insertBefore : tarEl.appendChild;
    return getOverwrittenAppendChildOrInsertBefore({
      rawDOMAppendOrInsertBefore: originFun,
      name,
      key: componentKey,
      container,
      target: tarEl,
      originalWindow,
      scopedCSS,
    });
  }
  const getProxyEl = (type: 'body' | 'head') => {
    if (fakeEle[type]) {
      return fakeEle[type];
    }
    const oldEl = originalWindow.document.querySelector(
      `${type}-element-${name.toLowerCase()}-${componentKey}`
    );
    if (oldEl) {
      return oldEl;
    }
    const CusEle = customElements.get(`${type}-element-${name.toLowerCase()}-${componentKey}`)!;
    fakeEle[type] = new CusEle();
    const proxyEl = fakeEle[type];
    if (proxyEl === null) {
      return proxyEl;
    }
    const originEl = originalWindow.document[type];
    proxyEl.classList.add(name);
    for (const key in originEl) {
      if (key === 'appendChild') {
        proxyEl.appendChild = getRewritedAppend(
          type,
          componentKey
        ) as typeof HTMLElement.prototype.appendChild;
      } else if (key === 'insertBefore') {
        proxyEl[key] = getRewritedAppend(
          type,
          componentKey,
          true
        ) as typeof HTMLElement.prototype.insertBefore;
      }
      // 部分属性对原对象运行造成影响
      else if (DOCUMENT_IGNORE_KEY.includes(key)) {
        //
      } else {
        try {
          const originEl = originalWindow.document[type] as any;
          let tarVal = originEl[key];
          if (typeof tarVal === 'function') {
            tarVal = getValueByHandleFunc(tarVal, originEl, true);
          }
          if (tarVal) {
            Object.defineProperty(proxyEl, key, {
              get() {
                return tarVal;
              },
              set(v) {
                originEl[key] = v;
                // return true;
              },
            });
          }
        } catch (e) {
          //
        }
      }
    }

    type === 'body' && originalWindow.document.body.appendChild(proxyEl);
    return proxyEl;
  };
  // 创建自定义元素代理document
  const CusDocument = customElements.get(`document-element-${name.toLowerCase()}-${componentKey}`)!;
  const newDoc = new CusDocument();
  for (const key in originalWindow.document) {
    if (key === 'head' || key === 'body') {
      Object.defineProperty(newDoc, key, {
        get() {
          return getProxyEl(key);
        },
      });
    } else if (key === 'querySelector' || key === 'getElementsByTagName') {
      Object.defineProperty(newDoc, key, {
        get() {
          return (selector: string) => {
            const originEl = (originalWindow.document as any)[key](selector);
            let el = originEl;
            if (originEl?.length) {
              el = el[0];
            }
            if (el instanceof HTMLHeadElement) {
              el = getProxyEl('head');
            }
            if (el instanceof HTMLBodyElement) {
              el = getProxyEl('body');
            }
            return originEl?.length ? [el] : el;
          };
        },
      });
    } else {
      try {
        const originEl = originalWindow.document as any;
        const originVal = originEl[key];
        let tarVal = originVal;
        if (typeof originVal === 'function') {
          tarVal = getValueByHandleFunc(originVal, originEl, true);
        }
        Object.defineProperty(newDoc, key, {
          get() {
            return tarVal;
          },
          set(v) {
            originEl[key] = v;
            // return true;
          },
        });
      } catch (e) {
        //
      }
    }
  }
  return newDoc;
};
