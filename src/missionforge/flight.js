import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// All cinematic distances are in scene metres, with the launch vehicle scaled for framing.
export function flightScene(panel) {
  const renderer = new T.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(1.5, devicePixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  panel.prepend(renderer.domElement);
  renderer.domElement.className = "flight-film";
  const scene = new T.Scene(),
    cam = new T.PerspectiveCamera(39, innerWidth / innerHeight, 0.05, 1500);
  scene.background = new T.Color(0x365165);
  scene.fog = new T.FogExp2(0x7c8687, 0.004);
  scene.add(new T.HemisphereLight(0xfff5df, 0x918073, 2.4));
  const sun = new T.DirectionalLight(0xffd2a1, 3.3);
  sun.position.set(-18, 27, 16);
  scene.add(sun);
  const rocket = new T.Group(),
    pad = new T.Group(),
    arrival = new T.Group(),
    crew = new T.Group();
  scene.add(rocket, pad, arrival);
  arrival.add(crew);
  const geo = (parent, shape, color, x, y, z) => {
    const m = new T.Mesh(
      shape,
      new T.MeshStandardMaterial({ color, roughness: 0.62 }),
    );
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const box = (p, x, y, z, w, h, d, c) =>
    geo(p, new T.BoxGeometry(w, h, d), c, x, y, z);
  const tube = (p, x, y, z, a, b, h, c) =>
    geo(p, new T.CylinderGeometry(a, b, h, 32), c, x, y, z);
  box(pad, 0, -0.45, 0, 24, 0.9, 18, 0x454c4c);
  box(scene, 0, -1.15, 0, 900, 1, 900, 0xab967a);
  for (let j = 0; j < 12; j++) {
    for (const x of [-5, -3])
      for (const z of [-2, 0])
        box(pad, x, j * 1.4 + 0.7, z, 0.15, 1.4, 0.15, 0x494945);
    box(pad, -4, j * 1.4, -1, 2.3, 0.12, 2.3, 0x74746a);
    box(pad, -4, j * 1.4 + 0.7, 0, 0.1, 2.3, 0.1, 0x7d7364).rotation.z = 0.92;
  }
  const fallback = tube(rocket, 0, 9, 0, 0.72, 0.9, 18, 0xecebe3);
  const nose = geo(
    rocket,
    new T.ConeGeometry(0.72, 2.8, 32),
    0xffffff,
    0,
    19.4,
    0,
  );
  const plume = geo(rocket, new T.ConeGeometry(0.9, 5, 24), 0xffad56, 0, -2, 0);
  plume.rotation.z = Math.PI;
  plume.material.emissive.setHex(0xff8439);
  const lower = tube(scene, 0, 0, 0, 0.92, 0.94, 6, 0xd2d2ca);
  const lander = new T.Group();
  arrival.add(lander);
  tube(lander, 0, 1.7, 0, 1.55, 2, 2.5, 0xc1b6a0);
  tube(lander, 0, 3.4, 0, 0.9, 1.55, 1, 0xf1e9d4);
  for (const x of [-1.6, 1.6])
    for (const z of [-1, 1]) {
      box(lander, x, 0.58, z, 0.13, 1.3, 0.13, 0x777774);
      tube(lander, x, 0.05, z, 0.35, 0.44, 0.12, 0x4b5354);
    }
  const rampPivot = new T.Group();
  rampPivot.position.set(0, 0.7, 1.78);
  lander.add(rampPivot);
  box(rampPivot, 0, 0.8, 0, 1.1, 1.6, 0.12, 0x727c77);
  const loader = new GLTFLoader();
  let stopped = false;
  function dispose(root) {
    root.traverse((o) => {
      o.geometry?.dispose();
      for (const mat of [].concat(o.material || [])) {
        for (const v of Object.values(mat)) if (v?.isTexture) v.dispose();
        mat.dispose();
      }
    });
  }
  function load(file, parent, height, ready) {
    loader.load(
      "/models/mission/" + file + ".glb",
      (g) => {
        const obj = g.scene;
        if (stopped) {
          dispose(obj);
          return;
        }
        let bounds = new T.Box3().setFromObject(obj),
          size = bounds.getSize(new T.Vector3());
        if (size.z > size.y && size.z > size.x) obj.rotation.x = -Math.PI / 2;
        else if (size.x > size.y) obj.rotation.z = Math.PI / 2;
        bounds.setFromObject(obj);
        obj.scale.multiplyScalar(height / (bounds.max.y - bounds.min.y));
        bounds.setFromObject(obj);
        const mid = bounds.getCenter(new T.Vector3());
        obj.position.set(-mid.x, -bounds.min.y, -mid.z);
        parent.add(obj);
        ready?.();
      },
      undefined,
      () => {},
    );
  }
  load("saturn-v", rocket, 21, () => {
    fallback.visible = false;
    nose.visible = false;
  });
  load("field-suit", crew, 1.85);
  const module = new T.Group();
  module.position.set(-7, 0, -4);
  arrival.add(module);
  load("medical", module, 3.3);
  const smoke = Array.from({ length: 35 }, (_, i) =>
    geo(
      scene,
      new T.IcosahedronGeometry(1, 1),
      i % 2 ? 0xaaa296 : 0xd2c9b3,
      0,
      0,
      0,
    ),
  );
  const start = performance.now(),
    clamp = T.MathUtils.clamp;
  let frame;
  function draw(now) {
    const t = (now - start) / 1000,
      ascent = Math.max(0, t - 2.4),
      land = t >= 6.3;
    pad.visible = rocket.visible = !land;
    arrival.visible = land;
    lower.visible = t >= 4.5 && !land;
    rocket.position.set(ascent * ascent * 0.25, ascent * ascent * 2.2, 0);
    rocket.rotation.z = -0.03 * ascent;
    plume.visible = ascent > 0;
    plume.scale.x = 0.8 + 0.15 * Math.sin(t * 61);
    lower.position.set(0.6, 9 + (t - 4.5) * 3 - (t - 4.5) ** 2 * 3, 0);
    lower.rotation.z = (t - 4.5) * 0.42;
    smoke.forEach((p, i) => {
      p.visible = t > 2.25 && !land;
      const r = (t - 2.25) * (1.2 + (i % 6) * 0.42),
        a = i * 2.4;
      p.position.set(
        Math.cos(a) * r,
        0.2 + Math.sin(i) * 0.4 + r * 0.12,
        Math.sin(a) * r,
      );
      p.scale.setScalar(Math.max(0.01, r * 0.28));
    });
    if (!land) {
      cam.position.set(13 + t, 7 + rocket.position.y * 0.8, 34);
      cam.lookAt(rocket.position.x, 9 + rocket.position.y, 0);
    } else {
      lander.position.y = Math.max(0, 2.5 - (t - 6.3) * 2.6);
      rampPivot.rotation.x = clamp(t - 7.3, 0, 1) * 1.98;
      crew.visible = t > 8.05;
      crew.position.set(
        0,
        Math.max(0, 0.69 - (t - 8.05) * 0.6),
        1.7 + Math.max(0, t - 8.05) * 1.25,
      );
      cam.position.set(8, 4, 13);
      cam.lookAt(-1, 1.5, 0);
    }
    renderer.render(scene, cam);
    frame = requestAnimationFrame(draw);
  }
  frame = requestAnimationFrame(draw);
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    dispose(scene);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}
