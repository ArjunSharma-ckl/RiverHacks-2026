import * as C from 'cesium';

// Where the camera sits on load and when you press Centre. The pitch is
// straight down: any tilt aims the camera past the globe's centre, which is
// what pushes Earth into a corner of the window.
export const HOME = { longitude: -62, latitude: 18, height: 24000000 };

const ORBIT_RATE = 0.6;    // radians per second
const ZOOM_RATE = 1.1;     // fraction of the current distance per second
const BOOST = 2.6;         // multiplier while Shift is held
const TAP = 0.16;          // seconds of travel for a single click or tap
const MAX_DISTANCE = 7.4e7;
const MIN_HEIGHT = 60;

const KEYS = new Map([
  ['w', 'up'], ['arrowup', 'up'],
  ['s', 'down'], ['arrowdown', 'down'],
  ['a', 'left'], ['arrowleft', 'left'],
  ['d', 'right'], ['arrowright', 'right'],
  ['+', 'in'], ['=', 'in'], ['e', 'in'],
  ['-', 'out'], ['_', 'out'], ['q', 'out']
]);

export function createControls(viewer, { onEscape } = {}) {
  const { camera, scene } = viewer;
  const held = new Set();
  let previous = performance.now();

  // So Cesium's own flyHome (used when you stop tracking a satellite) also
  // lands on a centred globe.
  C.Camera.DEFAULT_VIEW_RECTANGLE = C.Rectangle.fromDegrees(
    HOME.longitude - 80, -75, HOME.longitude + 80, 75
  );

  function homeView(duration = 0) {
    const destination = C.Cartesian3.fromDegrees(HOME.longitude, HOME.latitude, HOME.height);
    const orientation = { heading: 0, pitch: -C.Math.PI_OVER_TWO, roll: 0 };
    if (duration > 0) camera.flyTo({ destination, orientation, duration });
    else camera.setView({ destination, orientation });
  }

  function distance() {
    return viewer.trackedEntity
      ? Math.max(C.Cartesian3.magnitude(camera.position), 1)
      : Math.max(camera.positionCartographic.height, 1);
  }

  function move(direction, seconds) {
    // Constraining to the polar axis keeps "up" meaning north and stops the
    // view tumbling over the pole.
    camera.constrainedAxis = viewer.trackedEntity ? undefined : C.Cartesian3.UNIT_Z;
    const angle = ORBIT_RATE * seconds;
    if (direction === 'up') return camera.rotateUp(angle);
    if (direction === 'down') return camera.rotateDown(angle);
    if (direction === 'left') return camera.rotateLeft(angle);
    if (direction === 'right') return camera.rotateRight(angle);

    // Zoom moves by a fraction of the current distance, so it feels the same
    // whether you are at 24,000 km or 2 km.
    const current = distance();
    const amount = current * ZOOM_RATE * seconds;
    if (direction === 'in') {
      const room = current - (viewer.trackedEntity ? 5 : MIN_HEIGHT);
      if (room > 0) camera.zoomIn(Math.min(amount, room));
    } else if (current < MAX_DISTANCE) {
      camera.zoomOut(Math.min(amount, MAX_DISTANCE - current));
    }
  }

  // Driven per frame and scaled by real elapsed time, so movement is smooth
  // and frame-rate independent instead of waiting on key auto-repeat.
  scene.preUpdate.addEventListener(() => {
    const now = performance.now();
    const elapsed = Math.min((now - previous) / 1000, 0.08);
    previous = now;
    if (held.size === 0) return;
    const seconds = elapsed * (held.has('boost') ? BOOST : 1);
    for (const direction of held) {
      if (direction !== 'boost') move(direction, seconds);
    }
  });

  function press(direction) {
    if (held.has(direction)) return;
    held.add(direction);
    if (direction !== 'boost') move(direction, TAP);
  }

  function release(direction) {
    held.delete(direction);
  }

  function isTyping(target) {
    return Boolean(target?.closest?.('input, select, textarea, [contenteditable=true]'));
  }

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
    if (event.key === 'Escape') {
      held.clear();
      onEscape?.();
      return;
    }
    if (event.key === 'Shift') return press('boost');
    const direction = KEYS.get(event.key.toLowerCase());
    if (!direction) return;
    event.preventDefault();
    press(direction);
  });

  window.addEventListener('keyup', (event) => {
    if (event.key === 'Shift') return release('boost');
    const direction = KEYS.get(event.key.toLowerCase());
    if (direction) release(direction);
  });

  // A keyup lost to alt-tab would otherwise leave the camera drifting forever.
  window.addEventListener('blur', () => held.clear());

  homeView();

  return { press, release, home: () => homeView(1.1), stop: () => held.clear() };
}
