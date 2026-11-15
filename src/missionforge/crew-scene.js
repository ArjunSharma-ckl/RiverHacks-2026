import * as C from "cesium";
import { dutyPose, prepareDuties } from "./duties.js";
import { surfaceGravity } from "./simulation.js";

// Walking speeds, in metres per second on the ground. The simulation can run
// at fifty times real time, so the suits are never placed straight onto the
// duty pose: they walk toward it at a human pace and their legs swing with the
// distance actually covered. Animation therefore looks the same at every
// simulation speed instead of turning into a blur.
const WALK = 1.15;
const STRIDE = 0.8;        // metres per half stride
const TURN = 2.2;          // radians per second
const CATCH_UP = 2.6;      // most the walk can speed up to close a long gap

// One render listener drives both the suit and its camera from the same pose.
export function crewScene(viewer, base, local, unitMetres = 1.9) {
  const { camera, scene } = viewer;
  let mission = null,
    rate = 0,
    since = 0,
    preset = "",
    selected = 0,
    yaw = 0,
    pitch = 0,
    drag = null,
    frame = performance.now();
  // Where each suit actually is, between simulation ticks.
  const walkers = new Map();
  function reset() {
    const old = base.entities.getById("crew" + selected);
    if (old) old.show = true;
    mission = null;
    rate = 0;
    preset = "";
    drag = null;
    walkers.clear();
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
  const wrap = (angle) => ((angle % C.Math.TWO_PI) + 3 * Math.PI) % C.Math.TWO_PI - Math.PI;
  scene.preUpdate.addEventListener(() => {
    const now = performance.now();
    // Real seconds, for the animation; mission hours, for the duty target.
    const step = Math.min((now - frame) / 1000, 0.25);
    frame = now;
    if (!mission) return;
    const ahead = Math.min((now - since) / 1000, 3) * rate;
    const gravityFactor = Math.sqrt(9.81 / surfaceGravity(mission.cfg.mode));
    for (let i = 0; i < mission.cfg.crew; i++) {
      const entity = base.entities.getById("crew" + i);
      if (!entity) continue;
      const target = dutyPose(mission, i, ahead);
      const job = mission.duties[i].key;
      const heavy = job === "mine" || job === "build";
      let walker = walkers.get(i);
      if (!walker) {
        walker = { x: target.x, y: target.y, heading: target.heading, phase: 0, stroke: 0 };
        walkers.set(i, walker);
      }
      // Close the gap to the duty pose at a walking pace. A suit that has
      // fallen a long way behind hurries a little rather than teleporting.
      const dx = target.x - walker.x, dy = target.y - walker.y;
      const gap = Math.hypot(dx, dy) * unitMetres;
      const moving = target.walking && gap > 0.25;
      const pace = WALK * gravityFactor * Math.min(CATCH_UP, Math.max(1, gap / 14));
      const travelled = moving ? Math.min(gap, pace * step) : 0;
      if (travelled > 0) {
        const fraction = travelled / gap;
        walker.x += dx * fraction;
        walker.y += dy * fraction;
      } else if (!target.walking) {
        // Standing at a station: settle exactly onto the duty position.
        walker.x += dx * Math.min(1, step * 2);
        walker.y += dy * Math.min(1, step * 2);
      }
      const facing = moving ? Math.atan2(dx, dy) : target.heading;
      walker.heading += C.Math.clamp(wrap(facing - walker.heading), -TURN * step, TURN * step);
      // The legs swing with distance covered, so the stride never outruns the
      // ground, and the work stroke runs on the wall clock.
      walker.phase += (travelled / STRIDE) * Math.PI;
      walker.stroke += step * (heavy ? 1.5 : 2.1);
      const walk = moving ? Math.sin(walker.phase) : 0;
      const stroke = Math.sin(walker.stroke);
      const point = local(walker.x, walker.y);
      const cart = C.Cartographic.fromCartesian(point);
      cart.height += moving ? 0.045 * gravityFactor * Math.abs(walk) : 0;
      const world = C.Cartographic.toCartesian(cart);
      entity.position.setValue(world);
      // glTF +Z forward maps to Cesium model +X (east at zero heading).
      entity.orientation ??= new C.ConstantProperty();
      entity.orientation.setValue(
        C.Transforms.headingPitchRollQuaternion(
          world,
          new C.HeadingPitchRoll(walker.heading - Math.PI / 2,
            target.working && heavy ? -.12 - .1 * stroke : 0, 0),
        ),
      );
      for (const [name, angle] of [
        ["LegL", walk * 0.38],
        ["LegR", -walk * 0.38],
        [
          "ArmL",
          target.working ? (heavy ? -1.02 + .66 * stroke : -.85 + .14 * stroke) : -walk * 0.35,
        ],
        [
          "ArmR",
          target.working ? (heavy ? -.89 + .58 * stroke : -.64 - .25 * stroke) : walk * 0.35,
        ],
      ]) {
        const joint = entity.model.nodeTransformations?.[name];
        if (joint?.rotation) {
          joint.rotation.setValue(C.Quaternion.fromAxisAngle(axis, angle));
        }
      }
      entity.show = !(i === selected && preset === "Helmet");
      if (i !== selected || !["Helmet", "Follow crew"].includes(preset))
        continue;
      const follow = preset === "Follow crew",
        distance = follow ? 4.4 : 0;
      const destination = local(
        walker.x - Math.sin(walker.heading) * distance,
        walker.y - Math.cos(walker.heading) * distance,
        follow ? 2.6 : 1.68,
      );
      camera.setView({
        destination,
        orientation: {
          heading: walker.heading + yaw,
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
