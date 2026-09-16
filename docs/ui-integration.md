# 前端 B：UI 接入与自测

## 独立预览

通过 Live Server 打开 `index.html` 后点击中央体验入口，或直接打开 `index.html?ui-preview=public` / `index.html?ui-preview=demo`。
这是明确标注的 UI 模拟测试，不连接地图、API 或数据库，不用于持久化验收。
普通 `index.html` 仍等待统筹人提供 `app.js`。集成时移除 HTML 末尾预览脚本，改为唯一的 `js/app.js` 模块入口。

## 既定四个导出方法

- `initUI({ events, appMode })`：events 为同一个 EventTarget；appMode 为 public/demo。重复初始化会解除旧监听。
- `renderLayers(layers, currentLayerId)`：图层变化时清空旧表格并重置工具显示；不会发出任何 UI 事件。app.js 同步重置地图工具。
- `renderTable(featureCollection, selectedIds)`：刷新表格、选择和只读属性；不会发出选择事件。系统 ID 从 Feature 顶层读取，支持整数负 ID。
- `setStatus({ loading, saving, dirty, error })`：支持局部更新；error 是字符串或 null。dirty 由 app.js 维护。

UI 不直接访问网络或 OpenLayers source，不管理几何和持久化快照。属性值编辑为选作，当前只展示并保留原业务属性。

独立体验可额外传入 `initUI({ events, appMode, preview: true })`，仅将提交/成功提示改为模拟文案，不改变事件或数据行为。正式接入省略此项（默认 false），不要把它当作权限或环境安全开关。

## 文件与展示层变化

- `js/ui.js` 仍只有既定四个导出方法，新增内部辅助模块 `js/table-model.js`、`js/ui-icons.js`，集成时一并保留。
- `js/ui-preview.js` 只供独立体验，不替代 `map.js` / `app.js` / `api.js`。
- `#map` 仍是地图容器；普通入口保留 `#map-placeholder`，由集成代码在地图初始化成功后隐藏。
- 不新增运行时依赖，不修改地图、配置或后端；继续使用原生 ES Modules。

## 属性表与键盘行为

本地搜索覆盖 ID 与业务属性值（含数字、布尔和 null）；中文输入法组合输入完成后再过滤。
列标题可切换升序/降序，数字按数值排列；空值置后。每页50条只限制 DOM，完整 FeatureCollection 仍保留，后端不应因此截断到50条。
翻页/搜索/排序不会产生 ui:selection；选择在过滤与分页间保留，摘要区同时显示总选中数与当前页可见数。“仅看已选”用于快速检查跨页选择。
切换图层清空筛选与旧表；外部 renderTable 保留可用选择焦点和表格滚动位置，分页/过滤则从首行开始。
表格冻结选择列，长内容省略但保留原文本；单选要素后，在“当前编辑”的只读属性区可滚动查看全文。手机快速导航会移动焦点，不改变业务状态。

## 事件与操作完成通知

UI 按指南发出 ui:selection、ui:mode、ui:layer、ui:create-layer、ui:save、ui:cancel、ui:delete、ui:import、ui:export、ui:reset。
public 不发文件事件；demo 不发 reset。删除只接受一个选中 ID。渲染方法不会反向发事件。

除 selection/mode 外，事件发出前会锁定按钮，防止重复操作。app.js 每次处理完成，包括 cancel/reset/export，都必须调用：

```js
setStatus({ loading: false, saving: false, dirty: hasDraft, error: null });
```

失败时将 error 设置为可读字符串；保存失败保持 dirty:true。不要将失败当作 public 应用成功。
在异步操作开始时设置 loading:true 或 saving:true；操作结束后刷新图层/表格，再发送完成状态。
只清除 saving 而 loading 仍为 true 时，UI 继续锁定。创建失败保留名称、显示就近错误；确认成功后清空并收起创建表单，将焦点返回图层选择器。
保存/取消/删除失败除了全局提示，也会显示在编辑操作附近。成功或重试时清除相应错误，不由 UI 擅自清除 app.js 的草稿。
导入的 imported_count/warnings 可由 app.js 用 textContent 写入 #import-result，下载由 api.js 处理。

UI 通过同一总线的 map:draft-change 缓存业务属性副本，以确保 ui:save 返回完整属性；新建草稿使用新 Feature 的 properties（通常 {}）。
app.js 在收到草稿事件时设置 dirty:true。恢复、成功提交或取消草稿时设置 dirty:false。
开始另一个地图草稿前的拦截仍由 app.js/map.js 协调，避免在几何已改变后才提示。

## 草稿确认

切图层、切工具、切表格选择、创建图层、删除或文件操作遇到草稿时显示提交/放弃/返回编辑。
提交发 ui:save，放弃发 ui:cancel；只有 app.js 确认 dirty:false 且请求结束、没有错误后，才继续原操作。
失败会取消后续操作并保留草稿。reset 单独确认丢弃全部页面修改。
public 已应用、创建、删除后的临时状态会触发浏览器允许的离开提示，成功 reset 清除该标记。

## 手工验收

1. public 文件面板隐藏；demo 显示文件面板，保存文案正确且无 reset。
2. 切换点/线/面图层，绘制按钮按类型禁用；切层时旧表格清空。
3. 点表格行单选、复选框多选、再次选择取消；单选才可修改或删除。
4. 用“模拟修改草稿”测试提交、放弃、返回编辑；事件日志中的保存属性完整。
5. 创建图层名称不能为空/全空格/超过 100 字符，几何类型只能为 point/line/polygon。
6. demo ZIP 类型、空文件和 20 MiB 限制提前反馈；导入只发 File，导出只发 layerId。
7. 请求期间按钮禁用，保存失败保留草稿；刷新页面不会保留测试数据。
8. 最终与地图、app.js 和真实后端联调；模拟测试不能替代数据库刷新回读和 Shapefile 往返验收。

## 自动回归与边界

运行 `node tests/ui.test.cjs <playwright-package-path>`（需已有 Playwright 和本机 Edge）。入口会同时运行 `accessibility-audit.cjs` 与 `state-audit.cjs`。
覆盖 5000 要素展示、跨页选择、数字排序、长文本、中文输入、失败重试、草稿弹窗 Tab/Shift+Tab/Escape、焦点恢复、异步锁、离开提示、空图层、非法ID和预览隔离。
视口覆盖320/375/390/768/812横屏/1024/1440，另有200%文字压力、减少动画、强制颜色、标签/引用与语义色对比度检查。
截图输出 `tmp/ui-tests/`。这些是局部自动检查与人工视检，不是完整WCAG认证；未测试真实读屏器、Safari/iOS 或实际 Shapefile 数据往返。
