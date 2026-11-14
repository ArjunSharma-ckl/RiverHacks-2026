import { cue, toggleSound } from "./audio.js";
export function launchSequence(site) {
  return new Promise((resolve) => {
    const panel = document.createElement("div");
    panel.className = "launch-screen";
    const target = document.createElement("span");
    target.textContent = site;
    panel.innerHTML =
      '<div class="launch-stars"></div><header>MISSIONFORGE / MF-001 <button id="launch-mute">Sound off</button><button id="launch-skip">Skip sequence →</button></header><div class="launch-rocket"><div class="rocket-nose"></div><div class="rocket-body">MF<br>001</div><i class="booster left"></i><i class="booster right"></i><div class="engine"></div></div><footer><small>EXPEDITION TRANSFER · SIMULATED</small><h2 id="launch-phase">T−3 / Systems ready</h2><p>Destination · </p></footer>';
    panel.querySelector("footer p").append(target);
    document.body.append(panel);
    let stopFilm;
    if (!matchMedia("(prefers-reduced-motion:reduce)").matches)
      import("./flight.js")
        .then(({ flightScene }) => {
          if (panel.isConnected) {
            stopFilm = flightScene(panel);
            panel.classList.add("has-film");
          }
        })
        .catch(() => {});
    let ended = false,
      timers = [];
    const finish = () => {
      if (ended) return;
      ended = true;
      timers.forEach(clearTimeout);
      stopFilm?.();
      panel.remove();

      resolve();
    };
    panel.querySelector("#launch-skip").onclick = finish;
    const sound = panel.querySelector("#launch-mute");
    sound.textContent =
      localStorage.getItem("mf-sound") === "on" ? "Sound on" : "Sound off";
    sound.onclick = () =>
      (sound.textContent = toggleSound() ? "Sound on" : "Sound off");
    const stages = [
      [800, "T−2 / Guidance aligned", 440],
      [1600, "T−1 / Ignition", 330],
      [2400, "Liftoff / Ascent", 65],
      [4400, "First stage separation", 120],
      [5900, "Transfer complete / Field arrival", 220],
      [8100, "Ramp deployed / Crew egress", 440],
    ];
    stages.forEach(([ms, text, freq]) =>
      timers.push(
        setTimeout(() => {
          panel.querySelector("#launch-phase").textContent = text;
          cue(freq, ms === 2400 ? 3 : 0.3);
        }, ms),
      ),
    );
    timers.push(
      setTimeout(
        finish,
        matchMedia("(prefers-reduced-motion:reduce)").matches ? 1000 : 10500,
      ),
    );
  });
}
