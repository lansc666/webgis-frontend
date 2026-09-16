const ns = 'http://www.w3.org/2000/svg';
const shapes = {
  navigate: [['path', { d: 'M9 10V5a2 2 0 0 1 4 0v5-3a2 2 0 0 1 4 0v4-1a2 2 0 0 1 4 0v5c0 4-3 7-7 7h-1c-2 0-3-1-5-3l-5-5a2 2 0 0 1 3-3l3 3' }]],
  select: [['path', { d: 'm5 3 14 10-7 1-4 7Z' }]],
  box: [['rect', { x: 4, y: 4, width: 16, height: 16, rx: 2, 'stroke-dasharray': '3 3' }]],
  drawPoint: [['circle', { cx: 12, cy: 12, r: 5 }], ['circle', { cx: 12, cy: 12, r: 1, fill: 'currentColor' }]],
  drawLine: [['path', { d: 'M5 18 19 6' }], ['circle', { cx: 5, cy: 18, r: 2 }], ['circle', { cx: 19, cy: 6, r: 2 }]],
  drawPolygon: [['path', { d: 'm5 6 13-2 3 12-10 5-8-7Z' }]],
  modify: [['path', { d: 'm15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z' }]],
  layers: [['path', { d: 'm3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5' }]],
  table: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['path', { d: 'M3 10h18M9 4v16' }]],
  file: [['path', { d: 'M14 2H5v20h14V7l-5-5Zm0 0v5h5M8 12h8M8 16h6' }]]
};
export function createIcon(name) {
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attributes] of shapes[name] ?? shapes.drawPoint) {
    const child = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) child.setAttribute(key, String(value));
    svg.append(child);
  }
  return svg;
}
