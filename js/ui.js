
// 只维护 UI 状态；数据、草稿快照和网络请求由 app.js 管理。
import { buildTableView } from './table-model.js';
import { createIcon } from './ui-icons.js';
const families = { point: '点', line: '线', polygon: '面' };
const drawing = { drawPoint: 'point', drawLine: 'line', drawPolygon: 'polygon' };
const numberFormat = new Intl.NumberFormat('zh-CN');
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
  state.operationFocus = document.activeElement;
  state.waiting = true;
  state.requestName = name;
  state.error = null;
  state.errorAction = null;
  state.message = null;
  refresh();
  emit(name, detail);
}
function save() {
  if (busy() || !state.dirty) return;
  request('ui:save', { properties: copy(state.draftProperties ?? selectedFeature()?.properties ?? {}) });
}
function guarded(action, trigger = document.activeElement) {
  if (busy()) return;
  if (!state.dirty) return action();
  state.pending = action;
  state.dialogFocus = trigger;
  nodes['draft-dialog'].returnValue = 'cancel';
  nodes['draft-dialog'].showModal();
}
function fieldError(inputId, errorId, message) {
  nodes[inputId].setAttribute('aria-invalid', String(Boolean(message)));
  nodes[errorId].textContent = message || '';
  nodes[errorId].hidden = !message;
}
function paintSelection() {
  if (state.onlySelected) { drawTable(); return; }
  for (const checkbox of nodes['table-container'].querySelectorAll('input[data-feature-id]')) {
    const checked = state.selected.includes(Number(checkbox.dataset.featureId));
    checkbox.checked = checked;
    checkbox.closest('tr').setAttribute('aria-selected', String(checked));
  }
  refresh();
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
    button.title = drawing[mode] && drawing[mode] !== layer?.geometry_family
      ? '请选择' + families[drawing[mode]] + '图层后使用' : mode === 'modify' && state.selected.length !== 1
        ? '仅选择一个要素后可修改' : '';
  }
  nodes['tool-hint'].textContent = !layer ? '先选择或创建图层，再使用对应绘制工具。'
    : state.dirty ? '当前有未提交草稿，切换工具或图层前请处理草稿。'
    : drawing[state.mode] ? '绘制' + families[drawing[state.mode]] + ' · 完成绘制后，在右侧确认并提交草稿。'
    : state.mode === 'modify' ? '修改几何 · 拖动选中要素的顶点，完成后提交草稿。'
    : state.mode === 'box' ? '框选 · 在地图上拖出选框，可选中多个相交要素。'
    : state.mode === 'select' ? '点选 · 选择地图要素，或勾选下方属性表。'
    : '漫游 · 拖动地图平移，滚轮缩放；切换工具开始选择或绘制。';
  nodes['save-button'].disabled = locked || !state.dirty;
  nodes['cancel-button'].disabled = locked || !state.dirty;
  nodes['delete-button'].disabled = locked || state.selected.length !== 1;
  nodes['import-file'].disabled = locked || state.appMode !== 'demo';
  nodes['import-button'].disabled = locked || state.appMode !== 'demo' || !state.file;
  nodes['export-button'].disabled = locked || state.appMode !== 'demo' || !layer;
  nodes['reset-button'].disabled = locked || state.appMode !== 'public';
  for (const checkbox of nodes['table-container'].querySelectorAll('input')) checkbox.disabled = locked || checkbox.dataset.invalid === 'true';
  nodes['draft-status'].textContent = state.dirty ? '草稿未提交' : '无草稿';
  nodes['draft-status'].dataset.dirty = String(state.dirty);
  nodes['selection-count'].textContent = '已选择 ' + state.selected.length + ' 个要素';
  const visibleSelected = (state.tableView?.features ?? []).filter(feature => state.selected.includes(feature.id)).length;
  nodes['table-selection-summary'].textContent = state.selected.length
    ? '已选择 ' + state.selected.length + ' 个要素 · 当前页可见 ' + visibleSelected + ' 个，翻页和筛选会保留选择。'
    : '勾选可多选，点选行可单选；选择与地图同步。';
  nodes['feature-search'].disabled = locked || !state.features.length;
  nodes['selected-only'].disabled = locked || !state.features.length;
  nodes['clear-selection'].disabled = locked || !state.selected.length;
  nodes['clear-filters'].disabled = locked || (!state.query && !state.onlySelected && !state.sort);
  nodes['table-prev'].disabled = locked || state.page <= 1;
  nodes['table-next'].disabled = locked || state.page >= (state.tableView?.pageCount ?? 1);
  for (const button of nodes['table-container'].querySelectorAll('[data-sort-field]')) button.disabled = locked;
  nodes['edit-hint'].textContent = state.selected.length > 1 ? '已多选 ' + state.selected.length + ' 个要素。修改或删除时请只保留一个。'
    : state.selected.length === 1 ? '已选中一个要素，可修改几何或删除。' : '先在地图或属性表中选择一个要素。';
  nodes['app-error'].hidden = !state.error;
  nodes['app-error'].textContent = state.error ?? '';
  const editingError = state.error && ['ui:save', 'ui:cancel', 'ui:delete'].includes(state.errorAction);
  nodes['editing-error'].hidden = !editingError;
  nodes['editing-error'].textContent = editingError ? state.error : '';
  nodes['layer-action-error'].hidden = !(state.error && state.errorAction === 'ui:create-layer');
  nodes['layer-action-error'].textContent = state.errorAction === 'ui:create-layer' ? state.error ?? '' : '';
  nodes['app-status'].textContent = state.loading ? '正在加载…'
    : state.saving ? (state.preview ? '正在模拟提交…' : state.appMode === 'demo' ? '正在保存到数据库…' : '正在应用到当前页面…')
    : state.waiting ? '正在处理，请稍候…'
    : state.error ? '操作未完成，请查看错误提示。'
    : state.dirty ? '有未提交草稿，请提交或取消。'
    : state.message || (state.preview ? '独立体验 · 未连接地图或数据库。' : state.appMode === 'public' ? '临时编辑，刷新后重置。' : '本地数据库模式 · 就绪');
  nodes['app-status'].dataset.busy = String(locked);
  const submitting = locked && state.requestName === 'ui:save';
  nodes['save-button'].textContent = submitting ? (state.preview ? '正在模拟提交…' : state.appMode === 'public' ? '正在应用…' : '正在保存…')
    : state.preview ? '模拟提交草稿' : state.appMode === 'public' ? '应用到当前页面' : '保存到数据库';
  nodes['save-button'].setAttribute('aria-busy', String(submitting));
  nodes['create-layer-button'].textContent = locked && state.requestName === 'ui:create-layer' ? '正在创建…' : '创建图层';
  nodes['sidebar'].setAttribute('aria-busy', String(locked));
  showProperties();
}

export function initUI({ events, appMode, preview = false }) {
  if (!events?.dispatchEvent || !events?.addEventListener) throw new TypeError('events 必须是事件总线');
  if (!['public', 'demo'].includes(appMode)) throw new TypeError('appMode 必须为 public 或 demo');
  listeners?.abort();
  listeners = new AbortController();
  const on = (target, name, handler) => target.addEventListener(name, handler, { signal: listeners.signal });
  nodes = {};
  const ids = ['app-mode', 'temporary-notice', 'map-toolbar', 'sidebar', 'layer-select', 'layer-info',
    'create-layer-form', 'create-layer-details', 'layer-name', 'geometry-family', 'create-layer-button', 'layer-action-error', 'current-layer-label',
    'selection-count', 'feature-count', 'table-container', 'properties-editor', 'draft-status',
    'save-button', 'cancel-button', 'delete-button', 'file-panel', 'import-file', 'import-button',
    'export-button', 'import-result', 'reset-panel', 'reset-button', 'app-status', 'app-error',
    'draft-dialog', 'draft-submit-button', 'tool-hint', 'edit-hint', 'editing-error', 'layer-name-error', 'import-error', 'import-file-info',
    'feature-search', 'selected-only', 'clear-selection', 'clear-filters', 'table-summary', 'table-page', 'table-prev', 'table-next', 'table-selection-summary', 'layer-type-badge'];
  for (const id of ids) {
    nodes[id] = document.getElementById(id);
    if (!nodes[id]) throw new Error('缺少 UI 元素：' + id);
  }
  state = { events, appMode, preview: Boolean(preview), layers: [], layerId: null, features: [], selected: [], mode: 'navigate',
    loading: false, saving: false, dirty: false, error: null, waiting: false, requestName: null,
    pending: null, resuming: false, draftProperties: null, file: null, temporaryChanges: false,
    message: null, errorAction: null, dialogFocus: null, operationFocus: null,
    query: '', onlySelected: false, sort: null, page: 1, tableView: null };
  if (nodes['draft-dialog'].open) nodes['draft-dialog'].close('cancel');
  const local = appMode === 'public', saveLabel = preview ? '模拟提交草稿' : local ? '应用到当前页面' : '保存到数据库';
  nodes['app-mode'].textContent = local ? '公开体验 · 临时编辑' : '本地演示 · 数据库模式';
  nodes['temporary-notice'].hidden = !local;
  nodes['temporary-notice'].textContent = '临时编辑，刷新后重置。切换图层会保留本页已应用的数据。';
  nodes['file-panel'].hidden = local;
  nodes['reset-panel'].hidden = !local;
  nodes['save-button'].textContent = saveLabel;
  nodes['draft-submit-button'].textContent = saveLabel;
  nodes['import-file'].value = '';
  nodes['import-result'].textContent = '';
  const modeNames = { navigate: '漫游', select: '点选', box: '框选', drawPoint: '绘制点', drawLine: '绘制线', drawPolygon: '绘制面', modify: '修改几何' };
  for (const button of nodes['map-toolbar'].querySelectorAll('[data-mode]')) {
    button.replaceChildren(createIcon(button.dataset.mode), element('span', modeNames[button.dataset.mode]));
  }
  nodes['import-file-info'].hidden = true;
  nodes['feature-search'].value = '';
  nodes['selected-only'].checked = false;
  fieldError('layer-name', 'layer-name-error', null);
  fieldError('import-file', 'import-error', null);
  on(nodes['map-toolbar'], 'click', event => {
    const button = event.target.closest('button[data-mode]');
    if (!button || button.disabled || button.dataset.mode === state.mode) return;
    guarded(() => { state.mode = button.dataset.mode; state.message = null; refresh(); emit('ui:mode', { mode: state.mode }); });
  });
  on(nodes['layer-select'], 'change', () => {
    const id = Number(nodes['layer-select'].value);
    nodes['layer-select'].value = state.layerId === null ? '' : String(state.layerId);
    if (id === state.layerId || !state.layers.some(layer => layer.id === id)) return;
    guarded(() => request('ui:layer', { layerId: id }), nodes['layer-select']);
  });
  on(nodes['create-layer-form'], 'submit', event => {
    event.preventDefault();
    if (busy()) return;
    const name = nodes['layer-name'].value.trim(), geometry_family = nodes['geometry-family'].value;
    if (!name || name.length > 100 || !Object.hasOwn(families, geometry_family)) {
      state.error = '请填写 1 至 100 个字符的图层名称，并选择点、线或面类型。';
      fieldError('layer-name', 'layer-name-error', '名称不能为空或全为空格，请输入 1–100 个字符。');
      nodes['layer-name'].focus();
      return refresh();
    }
    fieldError('layer-name', 'layer-name-error', null);
    guarded(() => request('ui:create-layer', { name, geometry_family }));
  });
  on(nodes['layer-name'], 'input', () => {
    if (nodes['layer-name'].getAttribute('aria-invalid') === 'true' && nodes['layer-name'].value.trim()) {
      fieldError('layer-name', 'layer-name-error', null);
    }
  });
  on(nodes['table-container'], 'click', event => {
    const sortButton = event.target.closest('[data-sort-field]');
    if (sortButton && !busy()) {
      const field = sortButton.dataset.sortField;
      state.sort = { field, direction: state.sort?.field === field && state.sort.direction === 'asc' ? 'desc' : 'asc' };
      state.page = 1;
      drawTable({ resetScroll: true });
      return;
    }
    const row = event.target.closest('tr[data-feature-id]');
    if (!row || busy()) return;
    if (event.target.closest('label') && event.target.tagName !== 'INPUT') return;
    const id = Number(row.dataset.featureId);
    if (!Number.isInteger(id)) return;
    const checkbox = row.querySelector('input');
    const multi = event.target === checkbox || event.ctrlKey || event.metaKey;
    const next = multi ? (state.selected.includes(id) ? state.selected.filter(value => value !== id) : [...state.selected, id])
      : (state.selected.length === 1 && state.selected[0] === id ? [] : [id]);
    checkbox.checked = state.selected.includes(id);
    guarded(() => {
      state.selected = next;
      state.message = null;
      paintSelection();
      emit('ui:selection', { ids: [...state.selected] });
    });
  });
  on(nodes['feature-search'], 'input', () => {
    if (busy() || state.composing) return;
    state.query = nodes['feature-search'].value;
    state.page = 1;
    drawTable({ resetScroll: true });
  });
  on(nodes['feature-search'], 'compositionstart', () => { state.composing = true; });
  on(nodes['feature-search'], 'compositionend', () => {
    state.composing = false;
    if (busy()) return;
    state.query = nodes['feature-search'].value; state.page = 1; drawTable({ resetScroll: true });
  });
  on(nodes['selected-only'], 'change', () => {
    if (busy()) return;
    state.onlySelected = nodes['selected-only'].checked; state.page = 1; drawTable({ resetScroll: true });
  });
  on(nodes['clear-filters'], 'click', () => {
    if (busy()) return;
    state.query = ''; state.onlySelected = false; state.sort = null; state.page = 1;
    nodes['feature-search'].value = ''; nodes['selected-only'].checked = false;
    drawTable({ resetScroll: true }); nodes['feature-search'].focus();
  });
  on(nodes['clear-selection'], 'click', () => guarded(() => {
    state.selected = []; paintSelection(); emit('ui:selection', { ids: [] });
    nodes['table-container'].focus({ preventScroll: true });
  }));
  for (const [id, increment] of [['table-prev', -1], ['table-next', 1]]) on(nodes[id], 'click', () => {
    if (busy() || nodes[id].disabled) return;
    state.page += increment; drawTable({ resetScroll: true });
    if (nodes[id].disabled) nodes['table-container'].focus();
  });
  on(nodes['save-button'], 'click', save);
  on(nodes['cancel-button'], 'click', () => { if (!busy() && state.dirty) request('ui:cancel'); });
  on(nodes['delete-button'], 'click', () => {
    if (busy() || state.selected.length !== 1) return;
    const ids = [...state.selected];
    guarded(() => {
      const scope = state.preview ? '当前模拟数据中' : state.appMode === 'public' ? '当前页面' : '数据库';
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
    fieldError('import-file', 'import-error', state.error);
    nodes['import-file-info'].hidden = !state.file;
    nodes['import-file-info'].textContent = state.file ? state.file.name + ' · ' + new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(state.file.size / 1024 / 1024) + ' MiB' : '';
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
  on(nodes['draft-dialog'], 'keydown', event => {
    if (event.key !== 'Tab') return;
    const buttons = [...nodes['draft-dialog'].querySelectorAll('button:not(:disabled)')];
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  on(nodes['draft-dialog'], 'close', () => {
    const choice = nodes['draft-dialog'].returnValue;
    if (!state.pending) return;
    if (!['submit', 'discard'].includes(choice)) {
      state.pending = null;
      if (state.dialogFocus?.isConnected && !state.dialogFocus.disabled) state.dialogFocus.focus();
      return;
    }
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
  nodes['layer-type-badge'].replaceChildren();
  if (layer) nodes['layer-type-badge'].append(createIcon({ point: 'drawPoint', line: 'drawLine', polygon: 'drawPolygon' }[layer.geometry_family]), element('span', families[layer.geometry_family] + '图层'));
  else nodes['layer-type-badge'].textContent = '未选择';
  nodes['current-layer-label'].textContent = layer ? '当前图层：' + layer.name + '（ID ' + layer.id + '）' : '当前图层：未选择';
  nodes['layer-info'].textContent = layer ? families[layer.geometry_family] + '图层 · 仅启用相应绘制工具。'
    : state.appMode === 'demo' ? '请创建图层或导入 Shapefile ZIP。' : '请创建或选择图层。';
  if (previous !== state.layerId) {
    state.mode = 'navigate';
    state.query = ''; state.onlySelected = false; state.sort = null; state.page = 1;
    nodes['feature-search'].value = ''; nodes['selected-only'].checked = false;
    renderTable({ type: 'FeatureCollection', features: [] }, []);
  }
  refresh();
}

export function renderTable(featureCollection, selectedIds = []) {
  state.features = copy(featureCollection.features);
  const validIds = new Set(state.features.map(feature => feature.id).filter(Number.isInteger));
  state.selected = [...new Set(selectedIds)].filter(id => validIds.has(id));
  drawTable();
}

function drawTable({ resetScroll = false } = {}) {
  const focusId = document.activeElement?.dataset.featureId;
  const sortFocus = document.activeElement?.dataset.sortField;
  const view = buildTableView(state.features, state);
  state.tableView = view;
  state.page = view.page;
  const container = nodes['table-container'];
  const scrollTop = resetScroll ? 0 : container.scrollTop, scrollLeft = container.scrollLeft;
  container.replaceChildren();
  const number = value => numberFormat.format(value);
  nodes['feature-count'].textContent = number(state.features.length) + ' 个要素';
  nodes['table-summary'].textContent = view.matchedCount
    ? '显示 ' + number(view.start) + '–' + number(view.end) + ' / ' + number(view.matchedCount) + ' 个要素'
    : state.features.length ? '没有符合筛选条件的要素' : '暂无要素';
  nodes['table-page'].textContent = view.page + ' / ' + view.pageCount;
  if (!view.features.length) {
    container.append(element('p', state.features.length ? (state.onlySelected ? '没有符合条件的已选要素。取消“仅看已选”或清除筛选可查看全部。' : '没有找到匹配项，请更换关键词或清除筛选。')
      : currentLayer() ? '此图层暂无要素，可使用对应工具绘制。' : '暂无要素，请先选择或创建图层。', 'empty-state'));
    refresh();
    if (focusId !== undefined) container.focus({ preventScroll: true });
    return;
  }
  const keys = view.keys;
  const table = element('table'), head = element('thead'), header = element('tr'), body = element('tbody');
  table.append(element('caption', '当前图层要素。勾选复选框可多选，列标题可排序。', 'sr-only'));
  for (const [title, field] of [['选择', null], ['要素 ID', '@id'], ['图层 ID', '@layer'], ...keys.map(key => [key, 'p:' + key])]) {
    const cell = element('th'); cell.scope = 'col';
    if (field) {
      const active = state.sort?.field === field;
      cell.setAttribute('aria-sort', active ? (state.sort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
      const button = element('button', undefined, 'sort-button');
      button.append(element('span', title, 'sort-label'));
      button.title = title;
      button.type = 'button'; button.dataset.sortField = field;
      button.setAttribute('aria-label', '按“' + title + '”' + (active && state.sort.direction === 'asc' ? '降序' : '升序') + '排列');
      const arrow = element('span', active ? (state.sort.direction === 'asc' ? '↑' : '↓') : '↕', 'sort-arrow');
      arrow.setAttribute('aria-hidden', 'true'); button.append(arrow); cell.append(button);
    } else cell.textContent = title;
    header.append(cell);
  }
  head.append(header);
  for (const feature of view.features) {
    const row = element('tr'), checkbox = element('input'), choice = element('td');
    row.dataset.featureId = String(feature.id);
    row.setAttribute('aria-selected', String(state.selected.includes(feature.id)));
    checkbox.type = 'checkbox';
    checkbox.name = 'selected-feature';
    checkbox.checked = state.selected.includes(feature.id);
    checkbox.dataset.invalid = String(!Number.isInteger(feature.id));
    checkbox.dataset.featureId = String(feature.id);
    checkbox.setAttribute('aria-label', '选择要素 ' + feature.id);
    const hitTarget = element('label', undefined, 'row-check');
    hitTarget.append(checkbox);
    choice.append(hitTarget);
    row.append(choice, element('td', feature.id ?? '未分配'), element('td', feature.layer_id ?? state.layerId ?? '—'));
    for (const key of keys) {
      const value = feature.properties?.[key];
      const text = value === undefined ? '—' : value === null ? 'null' : String(value);
      const cell = element('td', text);
      cell.title = text;
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body); container.append(table); refresh();
  container.scrollTop = scrollTop; container.scrollLeft = scrollLeft;
  if (focusId !== undefined) {
    let restored = false;
    for (const input of container.querySelectorAll('input[data-feature-id]')) {
      if (input.dataset.featureId === focusId && !input.disabled) { input.focus({ preventScroll: true }); restored = true; }
    }
    if (!restored) container.focus({ preventScroll: true });
  } else if (sortFocus !== undefined) {
    for (const button of container.querySelectorAll('[data-sort-field]')) if (button.dataset.sortField === sortFocus) button.focus({ preventScroll: true });
  }
}

export function setStatus(update) {
  const wasDirty = state.dirty;
  const operationHadFocus = document.activeElement === state.operationFocus;
  if (Object.hasOwn(update, 'error')) state.errorAction = update.error ? (state.requestName ?? state.errorAction) : null;
  for (const key of ['loading', 'saving', 'dirty', 'error']) {
    if (Object.hasOwn(update, key)) state[key] = update[key];
  }
  // app.js 完成操作后以 loading:false / saving:false 解除请求锁。
  const finished = (update.loading === false || update.saving === false) && !state.loading && !state.saving;
  if (finished) {
    state.waiting = false;
    if (!state.error && state.requestName) {
      const messages = {
        'ui:save': state.appMode === 'public' ? '已应用到当前页面。刷新后重置。' : '已保存到数据库。',
        'ui:cancel': '已取消当前草稿，恢复最近一次确认的内容。',
        'ui:delete': state.appMode === 'public' ? '已从当前页面删除。刷新后重置。' : '已从数据库删除。',
        'ui:create-layer': '图层已创建。请选择对应工具开始绘制。',
        'ui:reset': '已恢复初始样例，清空本页修改。'
      };
      state.message = messages[state.requestName]
        ? (state.preview ? '模拟操作完成 · 数据仅保留在本页，刷新后重置。' : messages[state.requestName]) : null;
      if (state.requestName === 'ui:create-layer') {
        nodes['layer-name'].value = '';
        nodes['create-layer-details'].open = false;
        state.operationFocus = nodes['layer-select'];
      }
    }
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
  else if (finished && state.operationFocus?.isConnected && !state.operationFocus.disabled
    && (operationHadFocus || document.activeElement === document.body || document.activeElement?.disabled)) {
    state.operationFocus.focus({ preventScroll: true });
  }
}
