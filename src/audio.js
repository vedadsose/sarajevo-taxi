/** Tiny synthesized engine + horn (no audio files). Starts on first user input (autoplay policy). */
export function createAudio() {
  let ctx = null, engine = null, horn = null, master = null;
  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    // engine: two detuned saws through a lowpass
    const g = ctx.createGain(); g.gain.value = 0.0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 1.2;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = 'sawtooth'; o2.type = 'square';
    o1.frequency.value = 60; o2.frequency.value = 30;
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master); o1.start(); o2.start();
    engine = { g, lp, o1, o2 };
    // horn: two oscillators, silent until pressed
    const hg = ctx.createGain(); hg.gain.value = 0;
    const h1 = ctx.createOscillator(), h2 = ctx.createOscillator(); h1.type = 'sawtooth'; h2.type = 'sawtooth';
    h1.frequency.value = 370; h2.frequency.value = 440;
    const hl = ctx.createBiquadFilter(); hl.type = 'lowpass'; hl.frequency.value = 1800;
    h1.connect(hl); h2.connect(hl); hl.connect(hg); hg.connect(master); h1.start(); h2.start();
    horn = { g: hg };
  }
  window.addEventListener('keydown', () => { init(); if (ctx.state === 'suspended') ctx.resume(); }, { once: false });
  return {
    update(kmh, throttle, hornOn) {
      if (!engine) return;
      const t = ctx.currentTime;
      const rpm = 0.25 + Math.min(1, Math.abs(kmh) / 120) * 0.9 + Math.abs(throttle) * 0.15;
      engine.o1.frequency.setTargetAtTime(55 + rpm * 110, t, 0.08);
      engine.o2.frequency.setTargetAtTime(27 + rpm * 55, t, 0.08);
      engine.lp.frequency.setTargetAtTime(350 + rpm * 900 + Math.abs(throttle) * 500, t, 0.1);
      engine.g.gain.setTargetAtTime(0.05 + rpm * 0.08 + Math.abs(throttle) * 0.05, t, 0.1);
      horn.g.gain.setTargetAtTime(hornOn ? 0.25 : 0, t, 0.02);
    },
  };
}
