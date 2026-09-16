# 前端 B：UI 接入与自测

## 独立预览

通过 Live Server 打开 `index.html?ui-preview=public` 或 `index.html?ui-preview=demo`。
这是明确标注的 UI 模拟测试，不连接地图、API 或数据库，不用于持久化验收。
普通 `index.html` 仍等待统筹人提供 `app.js`。集成时移除 HTML 末尾预览脚本，改为唯一的 `js/app.js` 模块入口。

## 既定四个导出方法

- `initUI({ events, appMode })`：events 为同一个 EventTarget；appMode 为 public/demo。重复初始化会解除旧监听。
- `renderLayers(layers, currentLayerId)`：图层变化时清空旧表格并重置工具显示；不会发出任何 UI 事件。app.js 同步重置地图工具。
- `renderTable(featureCollection, selectedIds)`：刷新表格、选择和只读属性；不会发出选择事件。系统 ID 从 Feature 顶层读取，支持整数负 ID。
- `setStatus({ loading, saving, dirty, error })`：支持局部更新；error 是字符串或 null。dirty 由 app.js 维护。

UI 不直接访问网络或 OpenLayers source，不管理几何和持久化快照。属性值编辑为选作，当前只展示并保留原业务属性。

## 事件与操作完成通知

UI 按指南发出 ui:selection、ui:mode、ui:layer、ui:create-layer、ui:save、ui:cancel、ui:delete、ui:import、ui:export、ui:reset。
public 不发文件事件；demo 不发 reset。删除只接受一个选中 ID。渲染方法不会反向发事件。

除 selection/mode 外，事件发出前会锁定按钮，防止重复操作。app.js 每次处理完成，包括 cancel/reset/export，都必须调用：

```js
setStatus({ loading: false, saving: false, dirty: hasDraft, error: null });
```

失败时将 error 设置为可读字符串；保存失败保持 dirty:true。不要将失败当作 public 应用成功。
在异步操作开始时设置 loading:true 或 saving:true；操作结束后刷新图层/表格，再发送完成状态。
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
