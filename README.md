# micro-component

## 介绍

micro-component 是一个跨技术栈的业务模块复用的解决方案，适用于：

- 需要接入第 2 方（或者第三方的）组件（或业务模板），存在技术栈不一致的情况
- 不同于社区内的其他微前端框架；不会劫持路由，不适用于整合多个网站于一个网站的场景

## 快速使用

1. 安装

```bash
npm install @atom-web/micro-module
```

2. 使用

```jsx
import { MicroModule } from '@atom-web/micro-module';

const App = () => {
  const moduleInfo = {
    /**
     * 组件唯一标识符
     */
    name: 'moduleName',
    /**
     * 组件被打包后上传的umd的静态资源地址
     */
    url: 'https://localhost/module.js',
    /**
     * 非必填
     * 若一个组件被页面多处使用，建议必填
     */
    id: 'moduleId', // 非必填
  };
  return <MicroModule moduleInfo={moduleInfo} />;
};
```

## 高阶

### 样式和脚本隔离

基于 Proxy 的运行沙箱
通过 with + new Function 的形式，为微应用脚本创建沙箱运行环境，并通过 Proxy 代理阻断沙箱内对 window 全局变量的访问和修改。
@atom-web/micro-module 内置了基于 @atom-web/sandbox 的沙箱隔离，通过 sandbox 属性开启：

### 组件间的通信

- 通过 props 的父子组件的通信机制

- 通过 pub、sub 的组件间的通信

### 性能优化

- 预加载

  通常主应用会依赖多个来自同一系统的多个组件；提供一种方案，这些组件间可以依赖复用，并且不会污染主应用；

  ```javascript
  import { preFetchRuntime } from '@atom-web/micro-module';

  preFetchRuntime([
    {
      id: 'react@16',
      url: ['https://g.alicdn.com/code/lib/react/16.14.0/umd/react.production.min.js'],
    },
    {
      id: 'react-dom@16',
      url: ['https://g.alicdn.com/code/lib/react-dom/16.14.0/umd/react-dom.production.min.js'],
    },
  ]);
  ```

- cache(待完善)

- 依赖外置

  通常主应用和微应用会共有一些基础依赖，比如 React、ReactDOM、组件库等。可以适当考虑微应用外置掉这些基础依赖，由主应用统一加载。比如，通过 webpack Externals 外置微应用的基础依赖：

  ```javascript
  // webpack.config.js
  module.exports = {
    // ...
    externals: {
      react: 'React',
      'react-dom': 'ReactDOM',
      antd: 'antd',
    },
  };
  ```

  并在主应用的 index.html 中加载基础依赖的 cdn 版本。

  ```html
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta http-equiv="x-ua-compatible" content="ie=edge,chrome=1" />
      <meta name="viewport" content="width=device-width" />
      <title>icestark Framework App</title>
    </head>

    <body>
      <div id="root"></div>
      <!-- 在主应用中加载基础依赖 -->
      <script src="https://cdnjs.cloudflare.com/ajax/libs/react/17.0.0/cjs/react.production.min.js"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/17.0.0/cjs/react-dom.production.min.js"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/antd/4.17.0-alpha.8/antd.min.js"></script>

      <!-- 加载主应用的脚本资源 -->
      <script src="//ice.alicdn.com/icestark/layout-app/build/js/index.js"></script>
    </body>
  </html>
  ```

- 组件的加载过程中，空白的画面的用户体验较差；可以给组件一个 loading 的"过渡"动画

```jsx
import { MicroModule } from '@atom-web/micro-module';
import Loading from './Loading';
const App = () => {
  return <MicroModule moduleInfo={moduleInfo} LoadingComponent={Loading} />;
};
```

- 组件在加载、执行过程中的错误的收集与捕获

```jsx
import { MicroModule } from '@atom-web/micro-module';
import Loading from './Loading';
const App = () => {
  return <MicroModule moduleInfo={moduleInfo} handleError={(err) => doSomeThing(err)} />;
};
```

## api

## 最佳实践
