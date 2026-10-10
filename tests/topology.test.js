const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const html = fs.readFileSync("index.html", "utf8");
assert.match(html, /<html lang="ru">/);
// Фильтр с objectBoundingBox скрывал вертикальные и горизонтальные маршруты.
assert.match(html, /<filter id="glow"[^>]*filterUnits="userSpaceOnUse"[^>]*width="1160"[^>]*height="1000"/);
const start = html.indexOf("function createTopology() {");
const end = html.indexOf("const topology = createTopology();", start);
assert(start >= 0 && end > start, "Функция создания топологии не найдена");
const { nodes, links } = vm.runInNewContext(html.slice(start, end) + ";createTopology();");

assert.equal(nodes.length, 48);
assert.equal(new Set(nodes.map(node => node.id)).size, 48);
assert.equal(nodes.filter(node => node.cluster === "core").length, 12);
for (let c = 1; c <= 6; c++)
  assert.equal(nodes.filter(node => node.cluster === "outer" + c).length, 6);
assert.equal(links.length, 1128);
assert.equal(new Set(links.map(link => link.key)).size, 1128, "Повторные связи");
assert(links.every(link => link.a !== link.b), "Петли недопустимы");
const counts = Object.fromEntries(["C1-C1", "C1-C2", "C2-C2"].map(
  kind => [kind, links.filter(link => link.type === kind).length]
));
assert.deepEqual(counts, { "C1-C1": 66, "C1-C2": 972, "C2-C2": 90 });
const neighbors = Object.fromEntries(nodes.map(node => [node.id, new Set()]));
for (const link of links) {
  neighbors[link.a].add(link.b);
  neighbors[link.b].add(link.a);
}
for (const node of nodes) {
  const c1 = [...neighbors[node.id]].filter(id => id.startsWith("Ц-")).length;
  const c2 = [...neighbors[node.id]].filter(id => id.startsWith("В")).length;
  assert.equal(c1, node.type === "C1" ? 11 : 12, "Связи с кластером 1: " + node.id);
  assert.equal(c2, node.type === "C1" ? 36 : 35, "Связи с внешними кластерами: " + node.id);
  assert.equal(neighbors[node.id].size, 47, "Степень узла: " + node.id);
  for (const other of nodes) if (other.id !== node.id)
    assert(neighbors[node.id].has(other.id), "Нет прямой связи: " + node.id + " → " + other.id);
}
function reachable(source, removedNode, removedEdge) {
  const queue = [source], seen = new Set(queue);
  for (let i = 0; i < queue.length; i++) for (const next of neighbors[queue[i]]) {
    if (next === removedNode || seen.has(next)) continue;
    if ([queue[i], next].sort().join(":") === removedEdge) continue;
    seen.add(next);
    queue.push(next);
  }
  return seen;
}
const pairs = nodes.flatMap((a, i) => nodes.slice(i + 1).map(b => [a.id, b.id]));
assert.equal(reachable(nodes[0].id).size, 48);
// Один обход на отказ проверяет связность всех оставшихся узлов неориентированного графа.
for (const node of nodes) {
  const source = nodes.find(n => n.id !== node.id).id;
  assert.equal(reachable(source, node.id, null).size, 47, "Отказ " + node.id);
}
for (const link of links) {
  assert.equal(reachable(nodes[0].id, null, link.key).size, 48, "Отказ связи " + link.key);
}
// Проверяем реальные функции построения маршрутов из HTML, а не только связность графа.
const fStart = html.indexOf("function findRoute(start,end,via){");
const fEnd = html.indexOf("function render(){", fStart);
assert(fStart >= 0 && fEnd > fStart, "Функция поиска маршрута не найдена");
const findRoute = Function("adj", html.slice(fStart, fEnd) + ";return findRoute;")(neighbors);
for (const [a, b] of pairs) {
  for (const via of [null, "Ц-", ...Array.from({length:6}, (_, i) => "В" + (i+1) + "-")]) {
    const path = findRoute(a, b, via);
    assert(path && path[0] === a && path.at(-1) === b, "Нет пути " + a + " → " + b);
    assert.equal(path.length, via ? 3 : 2, "Неверная длина пути " + a + " → " + b);
    assert.equal(new Set(path).size, path.length, "Повтор узла в маршруте");
    if (via) assert(path.slice(1, -1).some(n => n.startsWith(via)), "Нет заданного обхода " + a + " → " + b);
    for (let i = 0; i < path.length - 1; i++) assert(neighbors[path[i]].has(path[i + 1]), "Разрыв пути: " + path.join(" → "));
  }
}
const posStart = html.indexOf("const pos = {};");
const posEnd = html.indexOf("const SVG=", posStart);
const positions = Function(html.slice(posStart, posEnd) + ";return pos;")();
const edgeStart = html.indexOf("function edgePath(a,b,curved=false){");
const edgeEnd = html.indexOf("const linkEls=", edgeStart);
const edgePath = Function("pos", html.slice(edgeStart, edgeEnd) + ";return edgePath;")(positions);
for (const link of links) for (const curved of [false, true]) {
  const geometry = edgePath(link.a, link.b, curved);
  assert(!/NaN|Infinity/.test(geometry), "Некорректная геометрия " + link.key);
  assert.match(geometry, /^M .+ Q .+$/);
}
// Два вертикальных участка обхода разведены по разные стороны от оси x=580.
const first = edgePath("Ц-1", "В4-1", true).match(/Q ([\d.-]+)/);
const second = edgePath("В4-1", "В1-1", true).match(/Q ([\d.-]+)/);
assert(Number(first[1]) < 580 && Number(second[1]) > 580);
console.log("Проверки пройдены: 48 узлов, 1128 связей, 47 соседей, маршруты через 7 кластеров, 1176 одиночных отказов, геометрия всех связей и регрессия вертикального маршрута через В4.");
