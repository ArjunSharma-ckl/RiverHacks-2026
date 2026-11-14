/* Normalize NASA source model origins and scale using glTF accessor bounds.
   Run once against freshly downloaded originals. Compressed meshes stay intact. */
import fs from "node:fs";
import { Matrix4, Quaternion, Cartesian3 } from "cesium";
for (const [name, height] of [
  ["crew", 1.85],
  ["habitat", 5.4],
  ["habitat2", 5.4],
  ["rover", 2.2],
]) {
  const file = "public/models/mission/" + name + ".glb",
    b = fs.readFileSync(file);
  const length = b.readUInt32LE(12),
    g = JSON.parse(b.toString("utf8", 20, 20 + length)),
    scene = g.scenes[g.scene ?? 0];
  if (name.startsWith("habitat"))
    for (const m of g.materials) {
      delete m.extensions;
      m.pbrMetallicRoughness.metallicFactor = 0;
      m.pbrMetallicRoughness.roughnessFactor = 0.85;
      m.emissiveTexture = m.pbrMetallicRoughness.baseColorTexture;
      m.emissiveFactor = [0.35, 0.35, 0.35];
    }
  if (g.nodes[scene.nodes[0]].name !== "MissionForge normalized origin") {
    const min = [Infinity, Infinity, Infinity],
      max = min.map(() => -Infinity);
    function visit(i, parent) {
      const n = g.nodes[i],
        v = (a) => Cartesian3.fromArray(a);
      const local = n.matrix
        ? Matrix4.fromArray(n.matrix)
        : Matrix4.fromTranslationQuaternionRotationScale(
            v(n.translation ?? [0, 0, 0]),
            Quaternion.unpack(n.rotation ?? [0, 0, 0, 1]),
            v(n.scale ?? [1, 1, 1]),
          );
      const m = Matrix4.multiply(parent, local, new Matrix4());
      for (const p of g.meshes?.[n.mesh]?.primitives ?? []) {
        const a = g.accessors[p.attributes.POSITION];
        for (const x of [a.min[0], a.max[0]])
          for (const y of [a.min[1], a.max[1]])
            for (const z of [a.min[2], a.max[2]]) {
              const t = Matrix4.multiplyByPoint(
                m,
                new Cartesian3(x, y, z),
                new Cartesian3(),
              );
              [t.x, t.y, t.z].forEach((u, j) => {
                min[j] = Math.min(min[j], u);
                max[j] = Math.max(max[j], u);
              });
            }
      }
      for (const child of n.children ?? []) visit(child, m);
    }
    for (const i of scene.nodes) visit(i, Matrix4.IDENTITY);
    const k = height / (max[1] - min[1]);
    scene.nodes = [
      g.nodes.push({
        name: "MissionForge normalized origin",
        children: scene.nodes,
        scale: [k, k, k],
        translation: [
          (-(min[0] + max[0]) * k) / 2,
          -min[1] * k,
          (-(min[2] + max[2]) * k) / 2,
        ],
      }) - 1,
    ];
  }
  const json = Buffer.from(JSON.stringify(g)),
    padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const header = Buffer.from(b.subarray(0, 20)),
    tail = b.subarray(20 + length);
  header.writeUInt32LE(20 + padded.length + tail.length, 8);
  header.writeUInt32LE(padded.length, 12);
  fs.writeFileSync(file, Buffer.concat([header, padded, tail]));
}
