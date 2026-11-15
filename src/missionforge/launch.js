const film = "/cinematics/mission-launch-720p.mp4";
const CACHE = "missionforge-cinematics-v1";

// The launch film is the heaviest single asset on the site. Put it in the Cache
// API on first load so a replay, or a second visit, plays from disk instead of
// pulling it over the network again.
export async function cacheFilm() {
  if (!("caches" in window)) return film;
  try {
    const store = await caches.open(CACHE);
    if (!(await store.match(film))) await store.add(film);
    const hit = await store.match(film);
    if (hit) return URL.createObjectURL(await hit.blob());
  } catch {
    // Private browsing, no quota, or an offline first load: fall back to the
    // network URL, which still works.
  }
  return film;
}

// The habitat models are what the simulation needs the moment the film ends,
// so fetch them while the viewer is watching rather than after.
export function warmSimulation() {
  const assets = [
    "habitat", "habitat2", "field-suit", "rover", "solar", "comms",
    "laboratory", "logistics", "medical", "recycler", "passage-ew", "passage-ns",
  ];
  for (const name of assets) {
    fetch("/models/mission/" + name + ".glb", { cache: "force-cache" }).catch(() => {});
  }
}

export function launchSequence() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    warmSimulation();
    return Promise.resolve();
  }
  const panel = document.createElement("dialog");
  panel.className = "launch-screen";
  panel.setAttribute("aria-label", "Expedition launch film");
  panel.innerHTML = `<video playsinline preload="auto"></video>
    <div class="launch-actions">
      <button type="button" id="launch-speed">2× speed</button>
      <button type="button" id="launch-skip">Skip</button>
    </div>
    <aside class="launch-note">Made by humans in blender</aside>`;
  const video = panel.querySelector("video");
  video.volume = .72;
  document.body.append(panel);
  panel.showModal();
  return new Promise((resolve) => {
    let watchdog;
    let objectUrl = "";
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(watchdog);
      video.pause();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load();
      panel.close();
      panel.remove();
      resolve();
    }
    const watch = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(finish, 7000);
    };
    video.ontimeupdate = () => {
      if (!done) watch();
    };
    video.onended = video.onerror = panel.oncancel = finish;
    panel.querySelector("#launch-skip").onclick = finish;
    const speed = panel.querySelector("#launch-speed");
    speed.onclick = () => {
      video.playbackRate = video.playbackRate === 2 ? 1 : 2;
      speed.textContent = video.playbackRate === 1 ? "2× speed" : "1× speed";
      speed.setAttribute("aria-pressed", String(video.playbackRate === 2));
    };
    video.defaultPlaybackRate = 1.5;
    video.playbackRate = 1.5;
    watch();
    // Build the habitat's assets while the film runs.
    warmSimulation();
    cacheFilm().then((source) => {
      if (done) return;
      if (source !== film) objectUrl = source;
      video.src = source;
      start();
    });
    function start() {
    video.play().catch(async () => {
      if (done) return;
      video.muted = true;
      try { await video.play(); } catch { finish(); }
    });
    }
  });
}
