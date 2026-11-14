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
    let audio,
      muted = true,
      ended = false,
      timers = [];
    function tone(freq, duration, volume = 0.05) {
      if (muted) return;
      try {
        audio ??= new AudioContext();
        audio.resume();
        const o = audio.createOscillator(),
          g = audio.createGain();
        o.type = "sawtooth";
        o.frequency.value = freq;
        g.gain.setValueAtTime(volume, audio.currentTime);
        g.gain.exponentialRampToValueAtTime(
          0.001,
          audio.currentTime + duration,
        );
        o.connect(g).connect(audio.destination);
        o.start();
        o.stop(audio.currentTime + duration);
      } catch {}
    }
    const finish = () => {
      if (ended) return;
      ended = true;
      timers.forEach(clearTimeout);
      panel.remove();
      audio?.close();
      resolve();
    };
    panel.querySelector("#launch-skip").onclick = finish;
    panel.querySelector("#launch-mute").onclick = (e) => {
      muted = !muted;
      e.target.textContent = muted ? "Sound off" : "Sound on";
      if (!muted) tone(130, 0.4);
    };
    const stages = [
      [800, "T−2 / Guidance aligned", 440],
      [1600, "T−1 / Ignition", 330],
      [2400, "Liftoff / Ascent", 65],
      [4400, "Booster separation", 120],
      [5900, "Transfer complete / Field arrival", 220],
      [7400, "Habitat systems online", 440],
    ];
    stages.forEach(([ms, text, freq]) =>
      timers.push(
        setTimeout(() => {
          panel.querySelector("#launch-phase").textContent = text;
          tone(freq, ms === 2400 ? 3 : 0.3);
        }, ms),
      ),
    );
    timers.push(
      setTimeout(
        finish,
        matchMedia("(prefers-reduced-motion:reduce)").matches ? 1000 : 8500,
      ),
    );
  });
}
