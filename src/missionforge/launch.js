const film = "/cinematics/mission-launch";
const phases = [
  [0, "T−3"], [2.2, "Ignition"], [3.0, "Tower clear"],
  [8.2, "Booster separation"], [14.0, "Core separation"],
  [16.7, "Orion separation"], [20.4, "Mars approach"],
  [23.3, "Powered descent"], [24.1, "Touchdown"],
  [26.0, "Crew egress"], [28.9, "Flag raised"],
];

export function launchSequence(site) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  const panel = document.createElement("dialog");
  panel.className = "launch-screen";
  panel.setAttribute("aria-label", "Expedition launch film");
  panel.innerHTML = `<video playsinline preload="auto" poster="${film}-poster.webp"></video>
    <header><strong>MISSIONFORGE</strong><button id="launch-mute"></button>
    <input type="range" min="0" max="1" step=".05" aria-label="Film volume">
    <button id="launch-skip">Skip film →</button></header>
    <footer><small>ILLUSTRATIVE FLIGHT</small><h2>T−3</h2><p></p></footer>`;
  const video = panel.querySelector("video");
  const mute = panel.querySelector("#launch-mute");
  const volume = panel.querySelector("input");
  const label = panel.querySelector("h2");
  panel.querySelector("p").textContent = site;
  video.muted = localStorage.getItem("mf-sound") !== "on";
  video.volume = Math.max(0, Math.min(1, Number(localStorage.getItem("mf-volume") ?? .72) || 0));
  volume.value = video.volume;
  const soundLabel = () => { mute.textContent = video.muted ? "Sound off" : "Sound on"; };
  soundLabel();
  mute.onclick = () => {
    video.muted = !video.muted;
    localStorage.setItem("mf-sound", video.muted ? "off" : "on");
    soundLabel();
  };
  volume.oninput = () => {
    video.volume = Number(volume.value);
    video.muted = video.volume === 0;
    localStorage.setItem("mf-volume", volume.value);
    localStorage.setItem("mf-sound", video.muted ? "off" : "on");
    soundLabel();
  };
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
      video.replaceChildren();
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
      if (done) return;
      label.textContent = phases.findLast(([time]) => video.currentTime >= time)[1];
      watch();
    };
    video.onended = video.onerror = panel.oncancel = finish;
    panel.querySelector("#launch-skip").onclick = finish;
    for (const [file, type] of [
      [matchMedia("(max-width: 700px)").matches ? "720p.mp4" : "1080p.mp4", "video/mp4"],
      ["1080p.webm", "video/webm"],
    ]) {
      const source = document.createElement("source");
      source.src = film + "-" + file;
      source.type = type;
      video.append(source);
    }
    watch();
    video.play().catch(async () => {
      if (done) return;
      video.muted = true;
      soundLabel();
      try { await video.play(); } catch { finish(); }
    });
  });
}
