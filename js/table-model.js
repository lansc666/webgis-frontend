// 仅对完整的已加载集合进行本地展示处理，不请求后端，也不截断源数据。
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const valueAt = (feature, field) => field === '@id' ? feature.id
  : field === '@layer' ? feature.layer_id : feature.properties?.[field.slice(2)];

export function buildTableView(features, { query = '', selected = [], onlySelected = false, sort = null, page = 1, pageSize = 50 } = {}) {
  const selectedIds = new Set(selected);
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  const keys = [...new Set(features.flatMap(feature => Object.keys(feature.properties ?? {})))].sort(collator.compare);
  const matched = features.filter(feature => {
    if (onlySelected && !selectedIds.has(feature.id)) return false;
    if (!needle) return true;
    return [feature.id, feature.layer_id, ...Object.values(feature.properties ?? {})]
      .some(value => String(value === null ? 'null' : value ?? '').toLocaleLowerCase('zh-CN').includes(needle));
  });
  if (sort) matched.sort((a, b) => {
    const first = valueAt(a, sort.field), second = valueAt(b, sort.field);
    if (first == null && second == null) return 0;
    if (first == null) return 1;
    if (second == null) return -1;
    const compared = typeof first === 'number' && typeof second === 'number'
      ? first - second : collator.compare(String(first), String(second));
    return sort.direction === 'desc' ? -compared : compared;
  });
  const pageCount = Math.max(1, Math.ceil(matched.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const start = (currentPage - 1) * pageSize;
  return { keys, matchedCount: matched.length, pageCount, page: currentPage,
    start: matched.length ? start + 1 : 0, end: Math.min(start + pageSize, matched.length),
    features: matched.slice(start, start + pageSize) };
}
