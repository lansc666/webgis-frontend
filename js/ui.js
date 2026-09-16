
// 只维护 UI 状态；数据、草稿快照和网络请求由 app.js 管理。
const families = { point: '点', line: '线', polygon: '面' };
const drawing = { drawPoint: 'point', drawLine: 'line', drawPolygon: 'polygon' };
let state, nodes, listeners;
const copy = value => structuredClone(value);
const busy = () => state.loading || state.saving || state.waiting;
const currentLayer = () => state.layers.find(layer => layer.id === state.layerId);
const selectedFeature = () => state.selected.length === 1
  ? state.features.find(feature => feature.id === state.selected[0]) : null;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function emit(name, detail = {}) {
  state.events.dispatchEvent(new CustomEvent(name, { detail }));
}
function request(name, detail = {}) {
  state.waiting = true;
  state.requestName = name;
  state.error = null;
  refresh();
  emit(name, detail);
}
function save() {
  if (busy() || !state.dirty) return;
  request('ui:save', { properties: copy(state.draftProperties ?? selectedFeature()?.properties ?? {}) });
}
function guarded(action) {
  if (busy()) return;
  if (!state.dirty) return action();
  state.pending = action;
  nodes['draft-dialog'].returnValue = 'cancel';
  nodes['draft-dialog'].showModal();
}
function showProperties() {
  const feature = selectedFeature();
  const properties = state.dirty ? state.draftProperties : feature?.properties;
  const container = nodes['properties-editor'];
  container.replaceChildren();
  if (!properties) {
    container.textContent = state.selected.length > 1 ? '已选择多个要素。修改或删除前，请仅选择一个。' : '选择要素查看属性，或绘制新要素。';
    return;
  }
  container.append(element('p', state.dirty ? '当前草稿属性（只读）'
    : '要素 ID：' + feature.id + ' · 图层 ID：' + (feature.layer_id ?? state.layerId)));
  const list = element('dl', undefined, 'property-list');
  for (const [key, value] of Object.entries(properties)) {
    list.append(element('dt', key), element('dd', value === null ? 'null' : String(value)));
  }
  container.append(Object.keys(properties).length ? list : element('p', '暂无业务属性'));
}
function refresh() {
  const locked = busy(), layer = currentLayer();
  nodes['layer-select'].disabled = locked || !state.layers.length;
  for (const id of ['layer-name', 'geometry-family', 'create-layer-button']) nodes[id].disabled = locked;
  for (const button of nodes['map-toolbar'].querySelectorAll('[data-mode]')) {
    const mode = button.dataset.mode;
    button.disabled = locked || (mode !== 'navigate' && !layer)
      || Boolean(drawing[mode] && drawing[mode] !== layer?.geometry_family)
      || (mode === 'modify' && state.selected.length !== 1);
    button.setAttribute('aria-pressed', String(state.mode === mode));
  }
  nodes['save-button'].disabled = locked || !state.dirty;
  nodes['cancel-button'].disabled = locked || !state.dirty;
  nodes['delete-button'].disabled = locked || state.selected.length !== 1;
  nodes['import-file'].disabled = locked || state.appMode !== 'demo';
  nodes['import-button'].disabled = locked || state.appMode !== 'demo' || !state.file;
  nodes['export-button'].disabled = locked || state.appMode !== 'demo' || !layer;
  nodes['reset-button'].disabled = locked || state.appMode !== 'public';
  for (const checkbox of nodes['table-container'].querySelectorAll('input')) checkbox.disabled = locked || checkbox.dataset.invalid === 'true';
  nodes['draft-status'].textContent = state.dirty ? '草稿未提交' : '无草稿';
  nodes['selection-count'].textContent = '已选择 ' + state.selected.length + ' 个要素';
  nodes['app-error'].hidden = !state.error;
  nodes['app-error'].textContent = state.error ?? '';
  nodes['app-status'].textContent = state.loading ? '正在加载…'
    : state.saving ? (state.appMode === 'demo' ? '正在保存到数据库…' : '正在应用到当前页面…')
    : state.waiting ? '正在处理，请稍候…'
    : state.error ? '操作未完成，请查看错误提示。'
    : state.dirty ? '有未提交草稿，请提交或取消。'
    : state.appMode === 'public' ? '临时编辑，刷新后重置。' : '本地数据库模式 · 就绪';
  nodes['sidebar'].setAttribute('aria-busy', String(locked));
  showProperties();
}

export function initUI({ events, appMode }) {
  if (!events?.dispatchEvent || !events?.addEventListener) throw new TypeError('events 必须是事件总线');
  if (!['public', 'demo'].includes(appMode)) throw new TypeError('appMode 必须为 public 或 demo');
  listeners?.abort();
  listeners = new AbortController();
  const on = (target, name, handler) => target.addEventListener(name, handler, { signal: listeners.signal });
  nodes = {};
  const ids = ['app-mode', 'temporary-notice', 'map-toolbar', 'sidebar', 'layer-select', 'layer-info',
    'create-layer-form', 'layer-name', 'geometry-family', 'create-layer-button', 'current-layer-label',
    'selection-count', 'feature-count', 'table-container', 'properties-editor', 'draft-status',
    'save-button', 'cancel-button', 'delete-button', 'file-panel', 'import-file', 'import-button',
    'export-button', 'import-result', 'reset-panel', 'reset-button', 'app-status', 'app-error',
    'draft-dialog', 'draft-submit-button'];
  for (const id of ids) {
    nodes[id] = document.getElementById(id);
    if (!nodes[id]) throw new Error('缺少 UI 元素：' + id);
  }
  state = { events, appMode, layers: [], layerId: null, features: [], selected: [], mode: 'navigate',
    loading: false, saving: false, dirty: false, error: null, waiting: false, requestName: null,
    pending: null, resuming: false, draftProperties: null, file: null, temporaryChanges: false };
  if (nodes['draft-dialog'].open) nodes['draft-dialog'].close('cancel');
  const local = appMode === 'public', saveLabel = local ? '应用到当前页面' : '保存到数据库';
  nodes['app-mode'].textContent = local ? '公开体验 · 临时编辑' : '本地演示 · 数据库模式';
  nodes['temporary-notice'].hidden = !local;
  nodes['temporary-notice'].textContent = '临时编辑，刷新后重置。切换图层会保留本页已应用的数据。';
  nodes['file-panel'].hidden = local;
  nodes['reset-panel'].hidden = !local;
  nodes['save-button'].textContent = saveLabel;
  nodes['draft-submit-button'].textContent = saveLabel;
  nodes['import-file'].value = '';
  nodes['import-result'].textContent = '';
  on(nodes['map-toolbar'], 'click', event => {
    const button = event.target.closest('button[data-mode]');
    if (!button || button.disabled || button.dataset.mode === state.mode) return;
    guarded(() => { state.mode = button.dataset.mode; refresh(); emit('ui:mode', { mode: state.mode }); });
  });
  on(nodes['layer-select'], 'change', () => {
    const id = Number(nodes['layer-select'].value);
    nodes['layer-select'].value = state.layerId === null ? '' : String(state.layerId);
    if (id === state.layerId || !state.layers.some(layer => layer.id === id)) return;
    guarded(() => request('ui:layer', { layerId: id }));
  });
  on(nodes['create-layer-form'], 'submit', event => {
    event.preventDefault();
    if (busy()) return;
    const name = nodes['layer-name'].value.trim(), geometry_family = nodes['geometry-family'].value;
    if (!name || name.length > 100 || !Object.hasOwn(families, geometry_family)) {
      state.error = '请填写 1 至 100 个字符的图层名称，并选择点、线或面类型。';
      return refresh();
    }
    guarded(() => request('ui:create-layer', { name, geometry_family }));
  });
  on(nodes['save-button'], 'click', save);
  on(nodes['cancel-button'], 'click', () => { if (!busy() && state.dirty) request('ui:cancel'); });
  on(nodes['delete-button'], 'click', () => {
    if (busy() || state.selected.length !== 1) return;
    const ids = [...state.selected];
    guarded(() => {
      const scope = state.appMode === 'public' ? '当前页面' : '数据库';
      if (window.confirm('确认从' + scope + '删除要素 ' + ids[0] + '？')) request('ui:delete', { ids });
    });
  });
  on(nodes['import-file'], 'change', () => {
    if (state.appMode !== 'demo' || busy()) return;
    const file = nodes['import-file'].files[0];
    state.file = null; state.error = null;
    if (file && !/\.zip$/i.test(file.name)) state.error = '请选择 .zip 文件。';
    else if (file && file.size > 20 * 1024 * 1024) state.error = 'ZIP 文件不能超过 20 MiB。';
    else if (file && !file.size) state.error = '不能导入空文件。';
    else state.file = file ?? null;
    if (state.error) nodes['import-file'].value = '';
    refresh();
  });
  on(nodes['import-button'], 'click', () => {
    if (state.appMode === 'demo' && state.file) guarded(() => request('ui:import', { file: state.file }));
  });
  on(nodes['export-button'], 'click', () => {
    if (state.appMode === 'demo' && currentLayer()) guarded(() => request('ui:export', { layerId: state.layerId }));
  });
  on(nodes['reset-button'], 'click', () => {
    if (state.appMode !== 'public' || busy()) return;
    if (window.confirm('恢复初始数据将丢弃本页全部修改、草稿和选择。确认恢复？')) request('ui:reset');
  });
  on(nodes['draft-dialog'], 'close', () => {
    const choice = nodes['draft-dialog'].returnValue;
    if (!state.pending) return;
    if (!['submit', 'discard'].includes(choice)) { state.pending = null; return; }
    state.resuming = true;
    if (choice === 'submit') save(); else request('ui:cancel');
  });
  // 使用既定事件缓存草稿属性副本；几何和正式草稿仍由 app.js 管理。
  on(events, 'map:draft-change', event => {
    const { kind, feature } = event.detail ?? {};
    if (!['create', 'update'].includes(kind) || !feature) return;
    state.draftProperties = copy(feature.properties ?? (kind === 'update' ? selectedFeature()?.properties : null) ?? {});
    showProperties();
  });
  on(window, 'beforeunload', event => {
    if (!state.dirty && !(state.appMode === 'public' && state.temporaryChanges)) return;
    event.preventDefault(); event.returnValue = '';
  });
  renderLayers([], null);
  renderTable({ type: 'FeatureCollection', features: [] }, []);
  refresh();
}

export function renderLayers(layers, currentLayerId) {
  state.layers = copy(layers);
  const previous = state.layerId;
  state.layerId = layers.some(layer => layer.id === currentLayerId) ? currentLayerId : null;
  const select = nodes['layer-select'];
  select.replaceChildren();
  if (state.layerId === null) {
    const placeholder = element('option', layers.length ? '请选择图层' : '暂无图层');
    placeholder.value = ''; placeholder.disabled = true; select.append(placeholder);
  }
  for (const layer of layers) {
    const option = element('option', layer.name + ' · ' + (families[layer.geometry_family] ?? '未知') + ' · ID ' + layer.id);
    option.value = String(layer.id); select.append(option);
  }
  select.value = state.layerId === null ? '' : String(state.layerId);
  const layer = currentLayer();
  nodes['current-layer-label'].textContent = layer ? '当前图层：' + layer.name + '（ID ' + layer.id + '）' : '当前图层：未选择';
  nodes['layer-info'].textContent = layer ? families[layer.geometry_family] + '图层 · 仅启用相应绘制工具。'
    : state.appMode === 'demo' ? '请创建图层或导入 Shapefile ZIP。' : '请创建或选择图层。';
  if (previous !== state.layerId) {
    state.mode = 'navigate';
    renderTable({ type: 'FeatureCollection', features: [] }, []);
  }
  refresh();
}

export function renderTable(featureCollection, selectedIds = []) {
  state.features = copy(featureCollection.features);
  const validIds = new Set(state.features.map(feature => feature.id).filter(Number.isInteger));
  state.selected = [...new Set(selectedIds)].filter(id => validIds.has(id));
  const container = nodes['table-container'];
  container.replaceChildren();
  nodes['feature-count'].textContent = state.features.length + ' 个要素';
  if (!state.features.length) {
    container.append(element('p', currentLayer() ? '此图层暂无要素，可使用工具栏绘制。' : '暂无要素，请先选择或创建图层。', 'empty-state'));
    refresh(); return;
  }
  const keys = [...new Set(state.features.flatMap(feature => Object.keys(feature.properties ?? {})))].sort();
  const table = element('table'), head = element('thead'), header = element('tr'), body = element('tbody');
  table.append(element('caption', '勾选可多选，点击行可单选。', 'table-caption'));
  for (const title of ['选择', '要素 ID', '图层 ID', ...keys]) {
    const cell = element('th', title); cell.scope = 'col'; header.append(cell);
  }
  head.append(header);
  for (const feature of state.features) {
    const row = element('tr'), checkbox = element('input'), choice = element('td');
    row.setAttribute('aria-selected', String(state.selected.includes(feature.id)));
    checkbox.type = 'checkbox';
    checkbox.checked = state.selected.includes(feature.id);
    checkbox.dataset.invalid = String(!Number.isInteger(feature.id));
    checkbox.setAttribute('aria-label', '选择要素 ' + feature.id);
    choice.append(checkbox);
    row.append(choice, element('td', feature.id ?? '未分配'), element('td', feature.layer_id ?? state.layerId ?? '—'));
    for (const key of keys) {
      const value = feature.properties?.[key];
      row.append(element('td', value === undefined ? '—' : value === null ? 'null' : String(value)));
    }
    row.addEventListener('click', event => {
      if (busy() || !Number.isInteger(feature.id)) return;
      const multi = event.target === checkbox || event.ctrlKey || event.metaKey;
      const next = multi ? (state.selected.includes(feature.id)
        ? state.selected.filter(id => id !== feature.id) : [...state.selected, feature.id])
        : (state.selected.length === 1 && state.selected[0] === feature.id ? [] : [feature.id]);
      checkbox.checked = state.selected.includes(feature.id);
      guarded(() => {
        renderTable({ type: 'FeatureCollection', features: state.features }, next);
        emit('ui:selection', { ids: [...state.selected] });
      });
    });
    body.append(row);
  }
  table.append(head, body); container.append(table); refresh();
}

export function setStatus(update) {
  const wasDirty = state.dirty;
  for (const key of ['loading', 'saving', 'dirty', 'error']) {
    if (Object.hasOwn(update, key)) state[key] = update[key];
  }
  // app.js 完成操作后以 loading:false / saving:false 解除请求锁。
  const finished = (update.loading === false || update.saving === false) && !state.loading && !state.saving;
  if (finished) {
    state.waiting = false;
    if (!state.error && state.appMode === 'public') {
      if (['ui:save', 'ui:delete', 'ui:create-layer'].includes(state.requestName)) state.temporaryChanges = true;
      if (state.requestName === 'ui:reset') state.temporaryChanges = false;
    }
    state.requestName = null;
  }
  if (state.dirty && !wasDirty && state.draftProperties === null) state.draftProperties = copy(selectedFeature()?.properties ?? {});
  if (!state.dirty) state.draftProperties = null;
  if (state.error) { state.pending = null; state.resuming = false; }
  const action = state.pending;
  const resume = state.resuming && action && !busy() && !state.dirty && !state.error;
  if (resume) { state.pending = null; state.resuming = false; }
  refresh();
  if (resume) action();
}
