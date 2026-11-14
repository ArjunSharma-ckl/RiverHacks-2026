// Generate the station's original glTF props in metres. glTF uses Y up.
import fs from "node:fs";
const materials = [
  ["Ceramic shell", [0.82, 0.85, 0.78], 0.18],
  ["Structural graphite", [0.12, 0.16, 0.17], 0.55],
  ["Survey orange", [0.94, 0.3, 0.07], 0.28],
  ["Blue glass", [0.09, 0.32, 0.4], 0.7],
  ["Brushed alloy", [0.49, 0.54, 0.54], 0.75],
  ["Medical green", [0.24, 0.59, 0.42], 0.24],
  ["Visor gold", [0.73, 0.46, 0.13], 0.86],
  ["Sunlit fabric", [0.92, 0.91, 0.8], 0.03],
].map(([name, color, metallicFactor]) => ({
  name,
  pbrMetallicRoughness: {
    baseColorFactor: [...color, 1],
    metallicFactor,
    roughnessFactor: metallicFactor > 0.6 ? 0.27 : 0.58,
  },
}));
function asset(name, build) {
  const nodes = [],
    roots = [],
    meshes = [],
    accessors = [],
    views = [],
    chunks = [],
    cache = new Map();
  let length = 0;
  function accessor(values, type) {
    const dim = type === "VEC3" ? 3 : 1,
      array =
        type === "VEC3" ? new Float32Array(values) : new Uint16Array(values);
    const data = Buffer.from(array.buffer),
      index =
        views.push({ buffer: 0, byteOffset: length, byteLength: data.length }) -
        1;
    chunks.push(data);
    length += data.length;
    const padding = (4 - (length % 4)) % 4;
    chunks.push(Buffer.alloc(padding));
    length += padding;
    const min = Array(dim).fill(Infinity),
      max = min.map(() => -Infinity);
    values.forEach((v, i) => {
      min[i % dim] = Math.min(min[i % dim], v);
      max[i % dim] = Math.max(max[i % dim], v);
    });
    return (
      accessors.push({
        bufferView: index,
        componentType: dim === 3 ? 5126 : 5123,
        count: values.length / dim,
        type,
        min,
        max,
      }) - 1
    );
  }
  function mesh(kind, material) {
    const key = kind + material;
    if (cache.has(key)) return cache.get(key);
    const pos = [],
      norm = [],
      idx = [];
    if (kind === "box") {
      for (let axis = 0; axis < 3; axis++)
        for (const sign of [-1, 1]) {
          const begin = pos.length / 3;
          for (const [u, v] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ]) {
            const p = [0, 0, 0],
              n = [0, 0, 0];
            p[axis] = sign * 0.5;
            n[axis] = sign;
            p[(axis + 1) % 3] = u * 0.5;
            p[(axis + 2) % 3] = v * sign * 0.5;
            pos.push(...p);
            norm.push(...n);
          }
          idx.push(begin, begin + 1, begin + 2, begin, begin + 2, begin + 3);
        }
    } else {
      const cols = 72,
        sphere = kind === "round",
        rings = sphere ? 25 : 4;
      for (let j = 0; j < rings; j++)
        for (let i = 0; i <= cols; i++) {
          const a = (i * Math.PI * 2) / cols,
            b = (j * Math.PI) / (rings - 1) - Math.PI / 2;
          const r = sphere ? Math.cos(b) : j === 0 || j === 3 ? 0 : 1,
            y = sphere ? Math.sin(b) : j < 2 ? -1 : 1;
          pos.push(0.5 * r * Math.cos(a), 0.5 * y, 0.5 * r * Math.sin(a));
          norm.push(
            r * Math.cos(a),
            sphere ? y : r === 0 ? y : 0,
            r * Math.sin(a),
          );
          if (j && i) {
            const k = j * (cols + 1) + i;
            idx.push(k - cols - 2, k - 1, k, k - cols - 2, k, k - cols - 1);
          }
        }
    }
    const id =
      meshes.push({
        primitives: [
          {
            attributes: {
              POSITION: accessor(pos, "VEC3"),
              NORMAL: accessor(norm, "VEC3"),
            },
            indices: accessor(idx, "SCALAR"),
            material,
          },
        ],
      }) - 1;
    cache.set(key, id);
    return id;
  }
  function part(
    label,
    translation,
    scale,
    mat,
    kind = "box",
    parent = null,
    rotation,
  ) {
    const node = { name: label, translation };
    if (scale) {
      node.scale = scale;
      node.mesh = mesh(kind, mat);
    }
    if (rotation) node.rotation = rotation;
    const id = nodes.push(node) - 1;
    (parent === null ? roots : (nodes[parent].children ??= [])).push(id);
    return id;
  }
  build(part);
  const g = {
    asset: { version: "2.0", generator: "MissionForge station workshop" },
    scene: 0,
    scenes: [{ nodes: roots }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: length }],
  };
  const json = Buffer.from(JSON.stringify(g)),
    pad = Buffer.alloc((4 - (json.length % 4)) % 4, 32),
    j = Buffer.concat([json, pad]);
  const head = Buffer.alloc(20),
    bin = Buffer.alloc(8);
  head.write("glTF");
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(28 + j.length + length, 8);
  head.writeUInt32LE(j.length, 12);
  head.write("JSON", 16);
  bin.writeUInt32LE(length);
  bin.write("BIN\0", 4);
  fs.writeFileSync(
    "public/models/mission/" + name + ".glb",
    Buffer.concat([head, j, bin, ...chunks]),
  );
}
for (const [name, accent] of [
  ["laboratory", 2],
  ["medical", 5],
  ["logistics", 4],
  ["recycler", 3],
]) {
  asset(name, (p) => {
    p("Foundation", [0, 0.17, 0], [5.9, 0.34, 3.9], 1);
    if (name === "recycler") {
      for (const x of [-1.35, 0, 1.35]) {
        p("Pressure vessel", [x, 1.28, 0], [1.24, 2.1, 1.24], 4, "tube");
        p("Domed cap", [x, 2.32, 0], [1.24, 0.55, 1.24], 0, "round");
        for (const y of [0.6, 1.7])
          p("Tank band", [x, y, 0], [1.28, 0.13, 1.28], 3, "tube");
      }
      p("Flow manifold", [0, 0.68, 1], [4.4, 0.16, 0.16], 2);
    } else {
      p("Pressure hull", [0, 1.7, 0], [5.3, 2.7, 3.4], 0);
      p("Roof", [0, 3.08, 0], [5.58, 0.22, 3.63], 4);
      for (const x of [-2.56, -1.23, 1.23, 2.56])
        p("Frame", [x, 1.72, 0], [0.12, 2.85, 3.52], 4);
      for (const z of [-1.72, 1.72]) {
        p("Service stripe", [0, 1.01, z], [5.2, 0.15, 0.07], accent);
        for (const x of [-1.7, 1.7]) {
          p("Window rim", [x, 2.03, z], [1.24, 0.88, 0.12], 1);
          p("Viewport", [x, 2.03, z * 1.035], [1.05, 0.68, 0.11], 3);
        }
      }
      p("Airlock", [0, 1.42, 1.78], [1.25, 2.2, 0.2], 1);
      p("Hatch", [0, 1.42, 1.9], [0.98, 1.93, 0.1], 4);
      for (let i = 0; i < 3; i++)
        p(
          "Entry tread",
          [0, 0.35 - i * 0.09, 2 + i * 0.26],
          [1.48, 0.15, 0.36],
          4,
        );
      if (name === "medical") {
        p("Medical sign", [0, 2.7, 1.75], [0.8, 0.16, 0.1], 5);
        p("Medical sign vertical", [0, 2.7, 1.75], [0.18, 0.63, 0.12], 5);
      }
      if (name === "laboratory")
        for (const x of [-1.7, 1.7])
          p("Roof skylight", [x, 3.21, 0], [1.2, 0.22, 1.5], 3, "round");
      if (name === "logistics")
        for (let i = 0; i < 3; i++) {
          p(
            "Sample container",
            [-2 + i * 1.38, 0.72, -2.25],
            [1.15, 0.85, 0.8],
            2,
          );
          p(
            "Container lid",
            [-2 + i * 1.38, 1.15, -2.25],
            [1.18, 0.09, 0.83],
            1,
          );
        }
    }
  });
}
asset("field-suit", (p) => {
  const joint = (n, t, parent) => p(n, t, null, null, null, parent);
  p("Suit torso", [0, 1.17, 0], [0.59, 0.65, 0.37], 7, "round");
  p("Life support pack", [0, 1.2, -0.2], [0.4, 0.53, 0.24], 0);
  p("Chest console", [0, 1.24, 0.17], [0.35, 0.25, 0.08], 1);
  p("Telemetry display", [-0.035, 1.26, 0.218], [0.17, 0.09, 0.018], 3);
  for (const side of [-1, 1]) {
    for (let j = 0; j < 5; j++)
      p(
        "Suit seam",
        [side * 0.2, 1.02 + j * 0.075, 0.165],
        [0.018, 0.012, 0.035],
        4,
      );
    p(
      "Helmet lamp",
      [side * 0.24, 1.78, 0.12],
      [0.075, 0.075, 0.1],
      0,
      "round",
    );
    p(
      "Lamp lens",
      [side * 0.24, 1.78, 0.175],
      [0.055, 0.055, 0.015],
      3,
      "round",
    );
  }
  p("Waist seal", [0, 0.94, 0], [0.47, 0.13, 0.32], 1, "tube");
  p("Collar", [0, 1.49, 0], [0.43, 0.09, 0.4], 4, "tube");
  p("Helmet", [0, 1.68, 0], [0.49, 0.48, 0.47], 0, "round");
  p("Visor frame", [0, 1.69, 0.11], [0.46, 0.34, 0.34], 1, "round");
  p("Visor", [0, 1.69, 0.145], [0.42, 0.3, 0.3], 6, "round");
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? "L" : "R",
      arm = joint("Arm" + side, [sign * 0.31, 1.4, 0]),
      leg = joint("Leg" + side, [sign * 0.15, 0.92, 0]);
    p("Shoulder", [0, -0.05, 0], [0.22, 0.22, 0.24], 2, "round", arm);
    p("Sleeve", [0, -0.22, 0.02], [0.19, 0.34, 0.19], 7, "round", arm);
    p("Elbow", [0, -0.33, 0.035], [0.165, 0.12, 0.17], 1, "tube", arm);
    p("Forearm", [0, -0.44, 0.06], [0.175, 0.24, 0.17], 0, "round", arm);
    p("Glove", [0, -0.57, 0.08], [0.16, 0.17, 0.16], 4, "round", arm);
    p("Thigh", [0, -0.2, 0], [0.24, 0.43, 0.24], 7, "round", leg);
    p("Knee", [0, -0.42, 0.03], [0.21, 0.17, 0.21], 1, "round", leg);
    p("Shin", [0, -0.6, 0], [0.21, 0.36, 0.21], 7, "round", leg);
    p("Boot", [0, -0.81, 0.045], [0.23, 0.18, 0.32], 4, "round", leg);
  }
});
