import * as C from "cesium";
import { dutyPose, prepareDuties } from "./duties.js";

// One render listener drives both the suit and its camera from the same pose.
export function crewScene(viewer, base, local) {
  const { camera, scene } = viewer;
  let mission = null,
    rate = 0,
    since = 0,
    preset = "",
    selected = 0,
    yaw = 0,
    pitch = 0,
    drag = null;
  function reset() {
    const old = base.entities.getById("crew" + selected);
    if (old) old.show = true;
    mission = null;
    rate = 0;
    preset = "";
    drag = null;
    scene.screenSpaceCameraController.enableInputs = true;
  }
  function cameraMode(mode, index = 0) {
    const old = base.entities.getById("crew" + selected);
    if (old) old.show = true;
    selected = index;
    preset = mode;
    yaw = 0;
    pitch = 0;
    drag = null;
    const attached = mode === "Helmet" || mode === "Follow crew";
    scene.screenSpaceCameraController.enableInputs = !attached;
    if (attached) camera.cancelFlight();
    return attached;
  }
  scene.canvas.addEventListener("pointerdown", (e) => {
    if (preset === "Helmet") {
      drag = [e.clientX, e.clientY];
      scene.canvas.setPointerCapture(e.pointerId);
    }
  });
  scene.canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    yaw += (e.clientX - drag[0]) * 0.005;
    pitch = C.Math.clamp(pitch - (e.clientY - drag[1]) * 0.005, -1, 1);
    drag = [e.clientX, e.clientY];
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    scene.canvas.addEventListener(type, () => (drag = null));
  const axis = C.Cartesian3.UNIT_X;
  scene.preUpdate.addEventListener(() => {
    if (!mission) return;
    const delta = Math.min((performance.now() - since) / 1000, 3) * rate;
    for (let i = 0; i < mission.cfg.crew; i++) {
      const entity = base.entities.getById("crew" + i);
      if (!entity) continue;
      const pose = dutyPose(mission, i, delta),
        clock = mission.duties[i].elapsed + delta;
      const phase = clock * 210,
        walk = pose.walking ? Math.sin(phase) : 0;
      const point = local(pose.x, pose.y);
      const cart = C.Cartographic.fromCartesian(point),
        terrain = scene.globe.getHeight(cart) ?? 0;
      const job = mission.duties[i].key;
      const heavy = job === "mine" || job === "build";
      const stroke = Math.sin(phase * (heavy ? 0.33 : 0.51));
      cart.height = terrain + (pose.walking ? 0.024 * Math.abs(walk) : 0);
      const world = C.Cartographic.toCartesian(cart);
      entity.position.setValue(world);
      // glTF +Z forward maps to Cesium model +X (east at zero heading).
      entity.orientation ??= new C.ConstantProperty();
      entity.orientation.setValue(
        C.Transforms.headingPitchRollQuaternion(
          world,
          new C.HeadingPitchRoll(pose.heading - Math.PI / 2,
            pose.working && heavy ? -.12 - .1 * stroke : 0, 0),
        ),
      );
      for (const [name, angle] of [
        ["LegL", walk * 0.38],
        ["LegR", -walk * 0.38],
        [
          "ArmL",
          pose.working ? (heavy ? -1.02 + .66 * stroke : -.85 + .14 * stroke) : -walk * 0.35,
        ],
        [
          "ArmR",
          pose.working ? (heavy ? -.89 + .58 * stroke : -.64 - .25 * stroke) : walk * 0.35,
        ],
      ]) {
        entity.model.nodeTransformations[name].rotation.setValue(
          C.Quaternion.fromAxisAngle(axis, angle),
        );
      }
      entity.show = !(i === selected && preset === "Helmet");
      if (i !== selected || !["Helmet", "Follow crew"].includes(preset))
        continue;
      const follow = preset === "Follow crew",
        distance = follow ? 4.4 : 0;
      const destination = local(
        pose.x - Math.sin(pose.heading) * distance,
        pose.y - Math.cos(pose.heading) * distance,
        terrain + (follow ? 2.6 : 1.68),
      );
      camera.setView({
        destination,
        orientation: {
          heading: pose.heading + yaw,
          pitch: follow ? -0.28 : -0.07 + pitch,
          roll: 0,
        },
      });
    }
  });
  return {
    reset,
    cameraMode,
    sync(m, speed) {
      prepareDuties(m);
      mission = m;
      rate = m.outcome === "In progress" ? speed / 30 : 0;
      since = performance.now();
    },
  };
}
