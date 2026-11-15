// Walkable pressure-loop graph, in metres east/north of the habitat.
// Routes follow the white connector tubes, so crew never cut through a module.
const nodes = {
  hub: [0, -2],
  north: [0, 15.2],
  west: [0, -2],
  bypassWest: [-6, -2],
  bypassNorth: [-6, 4],
  lab: [-13.5, -2],
  westLink: [-10.5, -2],
  quartersTop: [-10, -6],
  quarters: [-10, -15.9],
  south: [0, -8],
  southEnd: [0, -13],
  medical: [1.3, -13],
  water: [0, -9],
  waterDoor: [-13, -9],
  stores: [8.4, -8],
  fab: [0, 4],
  battery: [19, 4],
  power: [19, 13.2],
  forge: [22.4, 4],
  mineNorth: [22.4, 10],
  mineCorner: [24.5, 10],
  mine: [24.5, 17],
  buildLink: [-10.5, 2],
  buildMid: [-19, 2],
  buildBase: [-19, 0],
  build: [-19, 14.3],
  researchSouth: [19, -1],
  researchCorner: [40, -1],
  science: [40, -12],
  scienceDoor: [48.2, -12],
  bio: [40, 14],
  bioDoor: [44.1, 14],
  chem: [40, 26],
  chemDoor: [44.1, 26],
  transportJunction: [0, -16],
  transportCorner: [12, -16],
  transport1: [12, -20],
  transport2Corner: [-6, 15.2],
  transport2: [-10, 22]
};

const edges = [
  ['hub', 'south'], ['hub', 'west'], ['west', 'bypassWest'],
  ['bypassWest', 'bypassNorth'], ['bypassNorth', 'fab'], ['fab', 'north'],
  ['west', 'lab'], ['west', 'westLink'],
  ['westLink', 'quartersTop'], ['quartersTop', 'quarters'],
  ['westLink', 'buildLink'], ['buildLink', 'buildMid'], ['buildMid', 'buildBase'],
  ['buildBase', 'build'], ['buildMid', 'build'],
  ['south', 'southEnd'], ['southEnd', 'medical'], ['south', 'water'],
  ['water', 'southEnd'], ['water', 'waterDoor'],
  ['south', 'stores'],
  ['fab', 'battery'], ['battery', 'forge'], ['forge', 'mineNorth'],
  ['mineNorth', 'mineCorner'], ['mineCorner', 'mine'],
  ['battery', 'power'],
  ['battery', 'researchSouth'], ['researchSouth', 'researchCorner'],
  ['researchCorner', 'science'], ['science', 'scienceDoor'],
  ['researchCorner', 'bio'], ['bio', 'bioDoor'],
  ['bio', 'chem'], ['chem', 'chemDoor'],
  ['southEnd', 'transportJunction'], ['transportJunction', 'transportCorner'],
  ['transportCorner', 'transport1'], ['north', 'transport2Corner'],
  ['transport2Corner', 'transport2']
];

const graph = new Map(Object.keys(nodes).map((name) => [name, []]));
for (const [a, b] of edges) {
  const distance = Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1]);
  graph.get(a).push([b, distance]);
  graph.get(b).push([a, distance]);
}

function nearest(point) {
  let best = 'hub';
  let distance = Infinity;
  for (const [name, [x, y]] of Object.entries(nodes)) {
    const next = Math.hypot(point[0] - x, point[1] - y);
    if (next < distance) {
      best = name;
      distance = next;
    }
  }
  return { name: best, distance };
}

function shortest(start, end) {
  const distances = new Map(Object.keys(nodes).map((name) => [name, Infinity]));
  const previous = new Map();
  const pending = new Set(Object.keys(nodes));
  distances.set(start, 0);
  while (pending.size) {
    let current;
    let currentDistance = Infinity;
    for (const name of pending) {
      if (distances.get(name) < currentDistance) {
        current = name;
        currentDistance = distances.get(name);
      }
    }
    if (!current || current === end) break;
    pending.delete(current);
    for (const [next, weight] of graph.get(current) || []) {
      if (!pending.has(next)) continue;
      const alternative = currentDistance + weight;
      if (alternative < distances.get(next)) {
        distances.set(next, alternative);
        previous.set(next, current);
      }
    }
  }
  if (start === end) return [start];
  if (!previous.has(end)) return [];
  const path = [end];
  while (path[0] !== start) path.unshift(previous.get(path[0]));
  return path;
}

export const corridorNodes = nodes;

export function walkRoute(from, to) {
  const start = nearest(from);
  const end = nearest(to);
  const names = shortest(start.name, end.name);
  const points = [from, ...(names.length ? names.map((name) => nodes[name]) : []), to];
  return points.filter((point, index) => index === 0 || Math.hypot(point[0] - points[index - 1][0], point[1] - points[index - 1][1]) > 0.05);
}

export function pointOnRoute(points, fraction) {
  if (!points.length) return { x: 0, y: 0, heading: 0 };
  if (points.length === 1) return { x: points[0][0], y: points[0][1], heading: 0 };
  const lengths = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const length = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lengths.push(length);
    total += length;
  }
  let remaining = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining > lengths[i] && i < lengths.length - 1) {
      remaining -= lengths[i];
      continue;
    }
    const t = lengths[i] ? Math.min(1, remaining / lengths[i]) : 1;
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    return {
      x: ax + (bx - ax) * t,
      y: ay + (by - ay) * t,
      heading: Math.atan2(bx - ax, by - ay)
    };
  }
  const last = points[points.length - 1];
  const prior = points[points.length - 2] || last;
  return { x: last[0], y: last[1], heading: Math.atan2(last[0] - prior[0], last[1] - prior[1]) };
}
