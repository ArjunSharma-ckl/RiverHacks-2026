function extent(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return [ordered[Math.floor(ordered.length * 0.02)], ordered[Math.floor(ordered.length * 0.98)]];
}

export function createTerrainPreview(container, grid, label) {
  const canvas = document.createElement('canvas');
  canvas.width = 500;
  canvas.height = 350;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  const caption = document.createElement('p');
  caption.textContent = label + ' · Normalized vertical scale';
  const controls = document.createElement('div');
  const context = canvas.getContext('2d');
  const { size, values } = grid;
  const [low, high] = extent(values);
  const elevations = values.map(value => Math.max(0, Math.min(1, (value - low) / (high - low || 1))));
  let yaw = -0.55;
  let tilt = 0.66;
  let pointer;

  function draw() {
    context.fillStyle = '#0a1417';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const points = Array.from(elevations, (z, i) => {
      const x = (i % size) / (size - 1) - 0.5;
      const y = Math.floor(i / size) / (size - 1) - 0.5;
      const depth = x * sin + y * cos;
      return [250 + 330 * (x * cos - y * sin), 192 + 235 * depth * st - 92 * z * ct, depth];
    });
    const faces = [];
    for (let row = 0; row < size - 1; row++) {
      for (let col = 0; col < size - 1; col++) {
        const i = row * size + col;
        faces.push([i, (points[i][2] + points[i + size + 1][2]) / 2]);
      }
    }
    faces.sort((a, b) => a[1] - b[1]);
    for (const [i] of faces) {
      const light = Math.max(18, Math.min(76, 28 + 35 * elevations[i] + 130 * (elevations[i] - elevations[i + size])));
      context.fillStyle = 'hsl(' + (178 - 140 * elevations[i]) + ' 26% ' + light + '%)';
      context.beginPath();
      context.moveTo(...points[i].slice(0, 2));
      for (const j of [i + 1, i + size + 1, i + size]) context.lineTo(...points[j].slice(0, 2));
      context.closePath();
      context.fill();
    }
  }

  for (const [text, handler] of [
    ['Rotate left', () => { yaw -= Math.PI / 6; }],
    ['Rotate right', () => { yaw += Math.PI / 6; }],
    ['Change tilt', () => { tilt = tilt > 0.7 ? 0.45 : tilt + 0.3; }],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', () => { handler(); draw(); });
    controls.append(button);
  }
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    pointer = [event.clientX, event.clientY];
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointer) return;
    yaw += (event.clientX - pointer[0]) * 0.012;
    tilt = Math.max(0.18, Math.min(1.45, tilt + (event.clientY - pointer[1]) * 0.008));
    pointer = [event.clientX, event.clientY];
    draw();
  });
  canvas.addEventListener('lostpointercapture', () => { pointer = undefined; });
  container.replaceChildren(caption, canvas, controls);
  draw();
}
