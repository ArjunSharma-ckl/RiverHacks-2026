import { filmSource } from "./film-cache.js";

const fallbackFilm = "/cinematics/mission-launch-1080p.mp4";

export async function launchSequence() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
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
  // Play the cached Blender render when it is already in browser storage.
  const film = (await filmSource()) || fallbackFilm;
  video.volume = .72;
  document.body.append(panel);
  panel.showModal();
  return new Promise((resolve) => {
    let watchdog;
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(watchdog);
      video.pause();
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
    video.src = film;
    video.playbackRate = 1.5;
    watch();
    video.play().catch(async () => {
      if (done) return;
      video.muted = true;
      try { await video.play(); } catch { finish(); }
    });
  });
}
