// 仅供 ?ui-preview=public/demo 手工测试，不请求 API，不代表数据库验收。
import { initUI, renderLayers, renderTable, setStatus } from './ui.js';

const appMode = new URLSearchParams(location.search).get('ui-preview');
const events = new EventTarget();
const initial = [
  { id: -1, name: '校园设施', geometry_family: 'point' },
  { id: -2, name: '校园道路', geometry_family: 'line' },
  { id: -3, name: '校园区域', geometry_family: 'polygon' }
];
let layers, features, layerId, selected = [], nextId = -20, dirty = false;
function resetSamples() {
  layers = structuredClone(initial);
  layerId = -1;
  selected = [];
  features = new Map([[-1, [
    { type: 'Feature', id: -10, layer_id: -1, properties: { name: '图书馆', category: '教学', open: true, note: null }, geometry: { type: 'Point', coordinates: [116.39, 39.91] } },
    { type: 'Feature', id: -11, layer_id: -1, properties: { name: '南门', category: '出入口' }, geometry: { type: 'Point', coordinates: [116.40, 39.90] } }
  ]], [-2, []], [-3, []]]);
}
const collection = () => ({ type: 'FeatureCollection', features: features.get(layerId) ?? [] });
function render() { renderLayers(layers, layerId); renderTable(collection(), selected); }
function finish(error = null) { setStatus({ loading: false, saving: false, dirty, error }); }
initUI({ events, appMode });
resetSamples();
render();
document.getElementById('map-placeholder').hidden = true;
const panel = document.createElement('section');
panel.className = 'preview-panel';
const heading = document.createElement('h2');
heading.textContent = 'UI 独立测试 · 无地图 / 无数据库';
const note = document.createElement('p');
note.textContent = '当前为 ' + appMode + ' 界面测试。样例和操作结果仅在内存中，用于检查按钮、表格和事件；demo 测试 ID 也为模拟值。';
const log = document.createElement('pre');
log.id = 'preview-log';
log.textContent = '等待用户操作…';
const actions = document.createElement('div');
actions.className = 'action-row';
function button(text, handler) {
  const node = document.createElement('button');
  node.type = 'button'; node.textContent = text; node.addEventListener('click', handler); actions.append(node);
}
button('模拟修改草稿', () => {
  const feature = collection().features[0];
  if (!feature) { log.textContent = '请切回校园设施图层再模拟修改。'; return; }
  if (dirty) return;
  selected = [feature.id]; renderTable(collection(), selected);
  events.dispatchEvent(new CustomEvent('map:draft-change', { detail: { kind: 'update', id: feature.id, feature } }));
  dirty = true; finish();
});
button('模拟加载失败', () => finish('模拟错误：无法连接服务，请检查服务是否启动。'));
const link = document.createElement('a');
link.href = '?ui-preview=' + (appMode === 'public' ? 'demo' : 'public');
link.textContent = '切换到 ' + (appMode === 'public' ? 'demo' : 'public') + ' 界面测试';
panel.append(heading, note, actions, link, log);
document.querySelector('.map-stage').append(panel);
const notice = document.getElementById('temporary-notice');
notice.hidden = false;
notice.textContent = 'UI 独立测试：所有结果均为模拟，未连接地图或数据库。';
const eventNames = ['ui:selection', 'ui:mode', 'ui:layer', 'ui:create-layer', 'ui:save', 'ui:cancel', 'ui:delete', 'ui:reset', 'ui:import', 'ui:export'];
for (const name of eventNames) events.addEventListener(name, event => {
  const detail = event.detail;
  log.textContent = name + '\n' + JSON.stringify(detail, (key, value) => value instanceof File ? { name: value.name, size: value.size } : value, 2)
    + '\n（仅验证 UI 事件，无真实持久化）';
  if (name === 'ui:selection') selected = detail.ids;
  if (name === 'ui:layer') { layerId = detail.layerId; selected = []; render(); }
  if (name === 'ui:create-layer') {
    const layer = { id: nextId--, ...detail };
    layers.push(layer); features.set(layer.id, []); layerId = layer.id; selected = []; render();
  }
  if (name === 'ui:save' || name === 'ui:cancel') dirty = false;
  if (name === 'ui:delete') {
    features.set(layerId, collection().features.filter(feature => !detail.ids.includes(feature.id)));
    selected = []; render();
  }
  if (name === 'ui:reset') { dirty = false; resetSamples(); render(); }
  if (name === 'ui:import' || name === 'ui:export') {
    finish('文件事件已验证。真实上传和下载需接入 app.js、api.js 及后端服务。');
    return;
  }
  finish();
});
