import * as C from 'cesium';

// A released drag gives the outer globe a steady axial spin. The camera remains
// fully under Cesium's normal controls at terrain and settlement distances.
export function enableGlobeSpin(viewer) {
  const canvas = viewer.scene.canvas;
  const camera = viewer.camera;
  viewer.scene.screenSpaceCameraController.inertiaSpin = 0;
  let gesture = null, angularRate = 0, lastFrame = performance.now();
  const outer = () => camera.positionCartographic.height > 1_500_000;
  const stop = () => { angularRate = 0; };
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const wasSpinning = angularRate !== 0;
    stop();
    gesture = {id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,time:performance.now(),wasSpinning};
  });
  canvas.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    gesture.lastX = event.clientX;
  });
  canvas.addEventListener('pointerup', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX-gesture.x;
    const dy = event.clientY-gesture.y;
    const elapsed = Math.max(120, performance.now()-gesture.time);
    if (outer() && Math.abs(dx)>12 && Math.abs(dx)>Math.abs(dy)*0.6)
      angularRate = C.Math.clamp(dx / Math.max(canvas.clientWidth,1) * 0.515 * 1000 / elapsed,-0.0835,0.0835);
    gesture = null;
  });
  canvas.addEventListener('pointercancel',()=>{gesture=null;stop()});
  canvas.addEventListener('wheel',stop,{passive:true});
  canvas.addEventListener('dblclick',stop);
  viewer.scene.preUpdate.addEventListener(()=>{
    const now=performance.now(),dt=Math.min((now-lastFrame)/1000,0.08);
    lastFrame=now;
    if (!angularRate) return;
    if (!outer() || viewer.trackedEntity) {stop();return;}
    camera.rotate(C.Cartesian3.UNIT_Z,angularRate*dt);
  });
  return stop;
}
