import * as C from 'cesium';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toggle(label, checked, onChange, note) {
  const wrapper = element('label', 'toggle');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.onchange = () => onChange(input.checked);
  wrapper.append(input, element('span', undefined, label));
  if (note) wrapper.title = note;
  return { wrapper, input };
}

export function createHud(root, context) {
  const { viewer, scene, sky, satellites, weather, lensFlare } = context;
  const sections = element('div', 'hud-body');

  function section(heading) {
    const node = element('section');
    node.append(element('h3', undefined, heading));
    sections.append(node);
    return node;
  }

  const fleet = section('Satellite tracking');
  const selector = element('select');
  selector.setAttribute('aria-label', 'Track a satellite');
  selector.add(new Option('Earth overview', ''));
  for (const entity of satellites.entities) selector.add(new Option(entity.name, entity.id));
  selector.onchange = () => {
    const target = viewer.entities.getById(selector.value);
    if (target) target.show = true;
    satellites.track(target);
  };
  viewer.trackedEntityChanged.addEventListener(entity => { selector.value = entity?.id || ''; });
  fleet.append(selector, element('p', 'control-hint', 'W A S D orbit · + / − zoom · Esc return'));
  // Weather
  const weatherSection = section('Weather');
  const status = element('p', 'status');
  const master = toggle('Live weather on Earth', false, (on) => {
    weather.setMaster(on);
    syncLayerInputs();
  }, 'Turns on the default near-real-time stack');
  master.wrapper.classList.add('master');
  weatherSection.append(master.wrapper);

  const layerInputs = new Map();
  for (const spec of weather.layers) {
    const row = element('div', 'layer');
    const control = toggle(spec.label, false, (on) => {
      weather.setEnabled(spec.id, on);
      row.classList.toggle('on', on);
      master.input.checked = weather.layers.some((item) => item.on && weather.isEnabled(item.id));
    }, spec.note);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.05';
    slider.value = String(spec.alpha);
    slider.oninput = () => weather.setAlpha(spec.id, Number(slider.value));
    row.append(control.wrapper, slider);
    weatherSection.append(row);
    layerInputs.set(spec.id, { input: control.input, row });
  }
  weatherSection.append(status);

  function syncLayerInputs() {
    for (const [id, entry] of layerInputs) {
      const on = weather.isEnabled(id);
      entry.input.checked = on;
      entry.row.classList.toggle('on', on);
    }
  }

  context.setStatus((entries) => {
    if (entries.length === 0) {
      status.textContent = '';
      return;
    }
    status.replaceChildren();
    for (const entry of entries) {
      const line = element('span', entry.failing ? 'bad' : undefined,
        `${entry.label.split('—')[0].trim()} · ${entry.stamp}${entry.failing ? ' · unavailable' : ''}`);
      status.append(line);
    }
  });

  // Events
  const eventsSection = section('Active events');
  eventsSection.append(toggle('Natural events (NASA EONET)', false, (on) => {
    weather.setEvents(on);
  }, 'Open storms, wildfires, floods, volcanoes and ice events').wrapper);

  // Scene
  const sceneSection = section('Scene');
  const sceneToggles = [
    ['Planets', true, (on) => sky.setPlanets(on)],
    ['Stars', true, (on) => sky.setStars(on)],
    ['Star names', true, (on) => sky.setStarLabels(on)],
    ['Satellites', true, (on) => satellites.setFleet(on)],
    ['Satellite labels', true, (on) => satellites.setLabels(on)],
    ['Atmosphere', true, (on) => {
      scene.skyAtmosphere.show = on;
      scene.globe.showGroundAtmosphere = on;
    }],
    ['Sun glare', true, (on) => {
      if (lensFlare) lensFlare.enabled = on;
      scene.postProcessStages.bloom.enabled = on;
    }],
    ['Shadows', true, (on) => { viewer.shadows = on; }]
  ];
  for (const [label, initial, handler] of sceneToggles) {
    sceneSection.append(toggle(label, initial, handler).wrapper);
  }

  // Clock
  const clockSection = section('Clock');
  const buttons = element('div', 'buttons');
  for (const [label, hours] of [['Live', 0], ['−6h', 6], ['−24h', 24], ['−3d', 72]]) {
    const button = element('button', undefined, label);
    button.onclick = () => {
      viewer.clock.currentTime = hours === 0
        ? C.JulianDate.now()
        : C.JulianDate.addHours(C.JulianDate.now(), -hours, new C.JulianDate());
      for (const node of buttons.children) node.classList.remove('active');
      button.classList.add('active');
    };
    if (hours === 0) button.classList.add('active');
    buttons.append(button);
  }
  clockSection.append(buttons);

  root.insertBefore(sections, root.querySelector('footer'));

  const clockLabel = document.getElementById('clock');
  setInterval(() => {
    const date = C.JulianDate.toDate(viewer.clock.currentTime);
    clockLabel.textContent = `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
  }, 500);

  const hideButton = document.getElementById('hud-toggle');
  hideButton.onclick = () => {
    const hidden = root.classList.toggle('collapsed');
    hideButton.textContent = hidden ? 'Show controls' : 'Hide controls';
  };

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'h') hideButton.click();
  });

  return { syncLayerInputs };
}
