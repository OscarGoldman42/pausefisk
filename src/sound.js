// En blød klokke når tiden er gået (og et ding ved ét minut tilbage), genereret direkte i browseren (Web Audio) – ingen lydfiler.
// Der er bevidst ingen baggrundslyd, så underviseren kan afspille sin egen pausemusik.

const VOLUME = 0.6;

export function createSound() {
  let ctx = null;
  let master = null;
  let enabled = false;

  // Browsere tillader først lyd efter et klik eller tastetryk på siden
  function ensureContext() {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = VOLUME;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
  }
  for (const ev of ["pointerdown", "keydown"]) {
    window.addEventListener(ev, () => enabled && ensureContext(), { capture: true });
  }

  function setEnabled(on) {
    enabled = on;
    // Uden et klik endnu venter vi – lytterne ovenfor starter lyden ved første klik/tastetryk
    if (on && navigator.userActivation?.hasBeenActive) ensureContext();
  }

  // Tre toner (G5–E5–C5) med klokkeagtige overtoner, der klinger langsomt ud
  function bell() {
    if (!enabled || !ctx) return;
    const notes = [784, 659.3, 523.3];
    notes.forEach((freq, i) => strike(freq, ctx.currentTime + i * 0.55));
  }

  function strike(freq, t, volume = 1) {
    // Overtoner med forhold som en rigtig klokke; de høje dør hurtigst ud
    const partials = [
      [1, 1, 3.2],
      [2.0, 0.45, 2.0],
      [2.76, 0.3, 1.4],
      [5.4, 0.12, 0.7],
    ];
    for (const [ratio, level, decay] of partials) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq * ratio;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12 * level * volume, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + decay + 0.05);
    }
  }

  // Ét enkelt, blødt og kort ding – forvarsel når der er ét minut tilbage
  function ding() {
    if (!enabled || !ctx) return;
    strike(1046.5, ctx.currentTime, 0.45);
  }

  return { setEnabled, bell, ding };
}
