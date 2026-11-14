import { twoline2satrec, propagate, gstime, eciToEcf } from 'satellite.js';

let records = [];
self.onmessage = async ({ data }) => {
  if (data.init) {
    const response = await fetch('/data/active.tle');
    const lines = (await response.text()).trim().split(/\r?\n/);
    const names = [];
    for (let i = 0; i + 2 < lines.length; i += 3) {
      const record = twoline2satrec(lines[i+1], lines[i+2]);
      records.push(record);
      names.push([lines[i].trim(), record.satnum]);
    }
    self.postMessage({ names });
    return;
  }
  const date = new Date(data.time);
  const sidereal = gstime(date);
  const xyz = new Float64Array(records.length * 3).fill(NaN);
  const speeds = new Float32Array(records.length);
  records.forEach((record, index) => {
    const state = propagate(record, date);
    if (!state?.position) return;
    const p = eciToEcf(state.position, sidereal);
    speeds[index] = Math.hypot(state.velocity.x,state.velocity.y,state.velocity.z);
    xyz.set([p.x * 1000, p.y * 1000, p.z * 1000], index * 3);
  });
  self.postMessage({ xyz, speeds }, [xyz.buffer,speeds.buffer]);
};
