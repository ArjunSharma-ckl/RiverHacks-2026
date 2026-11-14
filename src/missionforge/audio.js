export function cue(frequency = 540, duration = 0.12) {
  if (localStorage.getItem("mf-sound") !== "on") return;
  try {
    const ac = (window.missionAudio ??= new AudioContext());
    void ac.resume().catch(() => {});
    const osc = ac.createOscillator(),
      gain = ac.createGain();
    osc.type = duration > 1 ? "sawtooth" : "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.055, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + duration);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  } catch {}
}
export function toggleSound() {
  const enabled = localStorage.getItem("mf-sound") !== "on";
  localStorage.setItem("mf-sound", enabled ? "on" : "off");
  cue();
  return enabled;
}
