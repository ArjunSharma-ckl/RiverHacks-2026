import places from './places.json';

const jobs = [
  [/STARLINK|ONEWEB|IRIDIUM|GLOBALSTAR|INTELSAT|EUTELSAT|ASTRA |SES-|INMARSAT|TDRS/i,'Communications'],
  [/NAVSTAR|GPS |GALILEO|BEIDOU|COSMOS.*GLONASS|QZSS/i,'Navigation'],
  [/NOAA|METEOR-M|METOP|GOES |FENGYUN|SUOMI|GPM/i,'Weather'],
  [/LANDSAT|SENTINEL|FLOCK|SKYSAT|AQUA|TERRA\b|WORLDVIEW/i,'Earth observation'],
  [/HST|HUBBLE|CHANDRA|TESS|SWIFT/i,'Astronomy'],
  [/ISS \(ZARYA\)|CSS \(TIANHE\)/i,'Crewed station']
];
export function mission(name) { return jobs.find(([pattern]) => pattern.test(name))?.[1] || 'Unclassified'; }

export const MISSION_COLORS = {
  'Communications': '#8fb7ff',
  'Navigation': '#ffd27f',
  'Weather': '#7ae0ff',
  'Earth observation': '#9affd1',
  'Astronomy': '#d9b8ff',
  'Crewed station': '#ff9f7f',
  'Unclassified': '#b5ced9'
};

export function catalogControls(root, fleet, choose) {
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'find';
  input.placeholder = 'Search satellites';
  input.setAttribute('aria-label', 'Search satellites by name, NORAD ID or mission');

  const place = document.createElement('input');
  place.type = 'search';
  place.placeholder = 'Within 1,000 km of a city';
  place.setAttribute('aria-label', 'Filter by location');

  const speed = document.createElement('select');
  speed.setAttribute('aria-label', 'Orbital speed');
  for (const [label, value] of [
    ['Any speed', ''], ['Below 5 km/s', 'slow'], ['5 to 7 km/s', 'medium'], ['Above 7 km/s', 'fast']
  ]) speed.add(new Option(label, value));

  const count = document.createElement('p');
  count.className = 'result-count';
  const list = document.createElement('ul');
  list.className = 'results';
  root.append(input, place, speed, count, list);

  let limit = 12;
  let matches = [];

  function filtered() {
    const query = input.value.trim().toLowerCase();
    const where = place.value.trim().toLowerCase();
    const centres = where
      ? places.filter(([city, country]) => city.toLowerCase().includes(where) || country.toLowerCase().includes(where))
      : [];
    return (fleet.contacts || []).filter((contact) => {
      if (!contact.speed) return false;
      if (query && ![contact.name, contact.norad, contact.job].join(' ').toLowerCase().includes(query)) return false;
      if ((speed.value === 'slow' && contact.speed >= 5)
        || (speed.value === 'medium' && (contact.speed < 5 || contact.speed > 7))
        || (speed.value === 'fast' && contact.speed <= 7)) return false;
      if (!where) return true;
      return centres.some(([, , lon, lat]) => {
        const rad = Math.PI / 180;
        return Math.sin((lat - contact.lat) * rad / 2) ** 2
          + Math.cos(lat * rad) * Math.cos(contact.lat * rad) * Math.sin((lon - contact.lon) * rad / 2) ** 2 <= 0.00615;
      });
    });
  }

  function render() {
    matches = filtered();
    list.replaceChildren();
    for (const contact of matches.slice(0, limit)) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'result';
      button.style.setProperty('--mission', MISSION_COLORS[contact.job] ?? MISSION_COLORS.Unclassified);

      const name = document.createElement('span');
      name.className = 'result-name';
      name.textContent = contact.name;
      const meta = document.createElement('span');
      meta.className = 'result-meta';
      meta.textContent = `${contact.job}, ${contact.speed.toFixed(2)} km/s, ${Math.round(contact.alt)} km up`;

      button.append(name, meta);
      button.onclick = () => choose(contact);
      item.append(button);
      list.append(item);
    }
    if (matches.length > limit) {
      const item = document.createElement('li');
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'result more';
      more.textContent = `Show ${Math.min(50, matches.length - limit)} more`;
      more.onclick = () => { limit += 50; render(); };
      item.append(more);
      list.append(item);
    }

    if (!fleet.contacts?.length) count.textContent = 'Loading the catalogue…';
    else if (!matches.length) count.textContent = 'Nothing matches. Try a name like Starlink, a NORAD ID, or a mission.';
    else count.textContent = `${matches.length.toLocaleString()} tracked`;
  }

  for (const field of [input, place, speed]) {
    field.oninput = () => { limit = 12; render(); };
  }
  // The catalogue refreshes every couple of seconds; don't yank the list out
  // from under someone who is reading it.
  fleet.refreshSearch = () => { if (!list.contains(document.activeElement)) render(); };
  render();
}
