// 独立 UI 演示：示意画布与所有数据均为模拟，不调用地图或后端 API。
import { initUI, renderLayers, renderTable, setStatus } from './ui.js';
import { createIcon } from './ui-icons.js';

const appMode = new URLSearchParams(location.search).get('ui-preview');
const sign = appMode === 'demo' ? 1 : -1;
const events = new EventTarget();
let layers, features, layerId, selected = [], nextId = 20, draft = null, working = false;
const baseGeometry = family => family === 'line'
  ? { type: 'LineString', coordinates: [[116.39, 39.91], [116.40, 39.90]] }
  : family === 'polygon' ? { type: 'Polygon', coordinates: [[[116.39, 39.91], [116.40, 39.91], [116.40, 39.90], [116.39, 39.91]]] }
  : { type: 'Point', coordinates: [116.39, 39.91] };
function sample(id, name, family, extra = {}) {
  return { type: 'Feature', id: sign * id, layer_id: sign * ({ point: 1, line: 2, polygon: 3 }[family]),
    properties: { name, ...extra }, geometry: baseGeometry(family) };
}
function resetSamples() {
  layers = [
    { id: sign, name: '校园设施', geometry_family: 'point' },
    { id: sign * 2, name: '校园道路', geometry_family: 'line' },
    { id: sign * 3, name: '校园区域', geometry_family: 'polygon' }
  ];
  layerId = sign; selected = []; nextId = 20; draft = null;
  features = new Map([
    [sign, [sample(10, '图书馆', 'point', { category: '教学', open: true, note: null }),
      sample(11, '南门', 'point', { category: '出入口', open: true, note: '步行入口' }),
      sample(12, '实验楼', 'point', { category: '科研', open: false, note: null })]],
    [sign * 2, [sample(13, '校园主路', 'line', { category: '道路', width: 8 }), sample(14, '步行小径', 'line', { category: '步行道', width: 3 })]],
    [sign * 3, [sample(15, '中心绿地', 'polygon', { category: '绿地', open: true }), sample(16, '运动场', 'polygon', { category: '体育', open: true })]]
  ]);
}
const collection = () => ({ type: 'FeatureCollection', features: features.get(layerId) ?? [] });
const layer = () => layers.find(item => item.id === layerId);
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function finish(error = null) {
  working = false;
  setStatus({ loading: false, saving: false, dirty: Boolean(draft), error });
  updatePreviewControls();
}
function render() { renderLayers(layers, layerId); renderTable(collection(), selected); renderScene(); }
initUI({ events, appMode, preview: true });
resetSamples();
document.getElementById('map-placeholder').hidden = true;
const stage = document.querySelector('.map-stage');
stage.dataset.preview = 'true';
const scene = el('div', undefined, 'preview-scene');
scene.setAttribute('role', 'group');
scene.setAttribute('aria-label', '校园数据示意画布，无真实坐标；通过标记按钮选择要素');
const sceneHeader = el('div', undefined, 'scene-header');
const sceneTitle = el('p', '', 'scene-title');
const sampleBadge = el('span', '示意画布 · 非真实地图', 'sample-badge');
sceneHeader.append(sceneTitle, sampleBadge);
const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
svg.setAttribute('viewBox', '0 0 800 400');
svg.setAttribute('preserveAspectRatio', 'none');
svg.setAttribute('aria-hidden', 'true');
svg.setAttribute('class', 'scene-base');
svg.innerHTML = '<path class="scene-land" d="M80 70H280V155H190V280H80Z M420 62H700V160H620V280H500V215H420Z"/><path class="scene-road-edge" d="M-20 325 270 225 400 250 820 95"/><path class="scene-road" d="M-20 325 270 225 400 250 820 95"/><path class="scene-path" d="M320 0 315 135 400 250 420 420"/><path class="scene-contour" d="M-20 40Q160-30 220 35T400 30M-20 55Q155-15 225 50T405 45M560 335Q650 280 825 345M560 350Q650 295 825 360"/>';
const markers = el('div', undefined, 'scene-markers');
const empty = el('p', '当前图层没有要素。创建一份模拟草稿开始体验。', 'scene-empty');
const sceneFooter = el('p', '点击示意标记或下方表格，查看选择联动。', 'scene-footer');
scene.append(svg, sceneHeader, markers, empty, sceneFooter);
stage.append(scene);

const controls = el('div', undefined, 'preview-controls');
const controlLabel = el('span', '体验操作', 'preview-control-label');
controls.append(controlLabel);
function action(text, handler, parent = controls) {
  const button = el('button', text);
  button.type = 'button'; button.addEventListener('click', handler); parent.append(button); return button;
}
function beginDraft(kind) {
  if (working || draft) return;
  const original = collection().features.find(feature => selected.includes(feature.id)) ?? collection().features[0];
  if (kind === 'update' && !original) return;
  const feature = kind === 'update' ? structuredClone(original)
    : { type: 'Feature', layer_id: layerId, properties: { name: '新建示例', category: '临时记录' }, geometry: baseGeometry(layer().geometry_family) };
  if (kind === 'update') feature.properties.note = '模拟修改示例';
  draft = { kind, feature };
  if (kind === 'update') selected = [feature.id];
  renderTable(collection(), selected);
  renderScene();
  events.dispatchEvent(new CustomEvent('map:draft-change', { detail: { kind, id: feature.id, feature } }));
  finish();
}
const modifyButton = action('模拟修改草稿', () => beginDraft('update'));
const createButton = action('模拟新建草稿', () => beginDraft('create'));
const switchLink = el('a', appMode === 'public' ? '体验数据库模式' : '体验临时编辑模式');
switchLink.href = '?ui-preview=' + (appMode === 'public' ? 'demo' : 'public');
controls.append(switchLink);
const consolePanel = el('details', undefined, 'preview-console');
const summary = el('summary', '联调工具与事件日志');
const log = el('pre', '等待操作…', 'event-log');
log.id = 'preview-log'; log.tabIndex = 0;
const failureActions = el('div', undefined, 'action-row');
action('模拟加载失败', () => { if (!working) finish('模拟错误：服务暂不可用。检查服务启动后，可继续操作。'); }, failureActions);
consolePanel.append(summary, failureActions, log);
document.querySelector('.map-panel').append(controls, consolePanel);
const notice = document.getElementById('temporary-notice');
notice.hidden = false;
notice.textContent = '独立体验 · 所有图形与操作结果均为模拟，仅保留在本页；未连接地图或数据库。';
document.getElementById('app-mode').textContent = appMode === 'public' ? '界面体验 · 临时编辑' : '界面体验 · 数据库模式';

function updatePreviewControls() {
  modifyButton.disabled = working || Boolean(draft) || !collection().features.length;
  createButton.disabled = working || Boolean(draft) || !layer();
  for (const marker of markers.querySelectorAll('button')) marker.disabled = working || Boolean(draft);
}
function renderScene() {
  const focused = document.activeElement?.dataset.previewId;
  sceneTitle.textContent = layer()?.name ?? '未选择图层';
  markers.replaceChildren();
  const positions = [[28, 34], [70, 67], [63, 29], [30, 73], [75, 48], [28, 53]];
  const family = layer()?.geometry_family;
  for (const [index, feature] of collection().features.slice(0, 6).entries()) {
    const label = String(feature.properties?.name ?? '要素 ' + feature.id);
    const marker = el('button', undefined, 'sample-marker');
    marker.type = 'button';
    marker.dataset.previewId = String(feature.id);
    marker.dataset.family = family;
    marker.disabled = working || Boolean(draft);
    marker.setAttribute('aria-label', '选择示意要素：' + label);
    marker.setAttribute('aria-pressed', String(selected.includes(feature.id)));
    const [x, y] = positions[index % positions.length];
    marker.style.setProperty('--marker-x', x + '%');
    marker.style.setProperty('--marker-y', y + '%');
    marker.append(createIcon({ point: 'drawPoint', line: 'drawLine', polygon: 'drawPolygon' }[family]), el('span', label));
    marker.addEventListener('click', () => {
      if (working || draft) return;
      selected = selected.length === 1 && selected[0] === feature.id ? [] : [feature.id];
      events.dispatchEvent(new CustomEvent('map:selection', { detail: { ids: [...selected] } }));
      renderTable(collection(), selected);
      renderScene();
      log.textContent = 'map:selection\n' + JSON.stringify({ ids: selected }, null, 2);
    });
    markers.append(marker);
  }
  empty.hidden = collection().features.length !== 0;
  sceneFooter.textContent = collection().features.length > 6
    ? '画布仅示意前 6 个要素，完整数据请查看下方属性表。'
    : '点击示意标记或下方表格，查看选择联动。';
  if (focused !== undefined) {
    const replacement = [...markers.querySelectorAll('button')].find(button => button.dataset.previewId === focused);
    if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
  }
}
const eventNames = ['ui:selection', 'ui:mode', 'ui:layer', 'ui:create-layer', 'ui:save', 'ui:cancel', 'ui:delete', 'ui:reset', 'ui:import', 'ui:export'];
for (const name of eventNames) events.addEventListener(name, event => {
  const detail = event.detail;
  log.textContent = name + '\n' + JSON.stringify(detail, (key, value) => value instanceof File ? { name: value.name, size: value.size } : value, 2)
    + '\n仅验证 UI 事件，无真实持久化。';
  if (name === 'ui:selection') { selected = detail.ids; renderScene(); }
  if (name === 'ui:mode') sceneFooter.textContent = '工具事件已发出：' + detail.mode + '。此画布仅演示选择，绘制请使用“模拟新建草稿”。';
  if (name === 'ui:layer') { layerId = detail.layerId; selected = []; render(); }
  if (name === 'ui:create-layer') {
    const created = { id: sign * nextId++, ...detail };
    layers.push(created); features.set(created.id, []); layerId = created.id; selected = []; render();
  }
  if (name === 'ui:save') {
    working = true; setStatus({ saving: true }); updatePreviewControls(); renderScene();
    window.setTimeout(() => {
      if (draft) {
        const saved = { ...structuredClone(draft.feature), id: draft.feature.id ?? sign * nextId++, properties: structuredClone(detail.properties) };
        if (draft.kind === 'create') features.get(layerId).push(saved);
        else features.set(layerId, collection().features.map(feature => feature.id === saved.id ? saved : feature));
        selected = [saved.id]; draft = null;
      }
      render();
      finish();
    }, 400);
    return;
  }
  if (name === 'ui:cancel') { draft = null; render(); }
  if (name === 'ui:delete') {
    features.set(layerId, collection().features.filter(feature => !detail.ids.includes(feature.id)));
    selected = []; render();
  }
  if (name === 'ui:reset') { resetSamples(); render(); }
  if (name === 'ui:import' || name === 'ui:export') {
    finish('文件事件已验证。真实上传和下载需接入本地数据服务。');
    return;
  }
  finish();
});
render();
finish();
