// sound.js — tiny Web Audio SFX player: a pool of decoded buffers played through
// one low-volume master gain (the faithful "single shared channel" from the
// Unity SoundManager). DOM/browser-only; the sim never calls into here.

const FILES = {
  shot:       'shot.wav',
  heavy_shot: 'heavy_shot.wav',
  damage:     'damage.wav',
  placement:  'placement.wav',
  error:      'error.wav',
  death:      'death.mp3',
};

export function createSound(base = 'assets/audio/') {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null, master = null;
  const buffers = {};
  let loaded = false;

  async function load() {
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    await Promise.all(Object.entries(FILES).map(async ([name, file]) => {
      try {
        const data = await fetch(base + file).then((r) => r.arrayBuffer());
        buffers[name] = await ctx.decodeAudioData(data);
      } catch { /* missing sound: silently skip */ }
    }));
    loaded = true;
  }

  // Browsers gate audio until a user gesture; call this from the first pointerdown.
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  function play(name, vol = 0.3) {
    if (!loaded || !ctx || !buffers[name]) return;
    const src = ctx.createBufferSource();
    src.buffer = buffers[name];
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(g); g.connect(master);
    src.start();
  }

  // Map one tick's sim events to sounds, de-duplicated so simultaneous hits/fires
  // don't machine-gun (mirrors the shared-channel feel).
  function playEvents(events) {
    if (!events || !events.length) return;
    const toPlay = new Set();
    for (const e of events) {
      switch (e.type) {
        case 'fire':
          toPlay.add((e.unit === 'TOWER' || e.unit === 'TANK' || e.unit === 'MTANK')
            ? 'heavy_shot' : 'shot');
          break;
        case 'hit':      toPlay.add('damage'); break;
        case 'spawn':    toPlay.add('placement'); break;
        case 'cast':     toPlay.add('placement'); break;
        case 'explosion':toPlay.add('heavy_shot'); break;
        case 'error':    toPlay.add('error'); break;
        case 'death':    toPlay.add('death'); break;
        case 'gameover': toPlay.add('death'); break;
      }
    }
    for (const name of toPlay) play(name, name === 'error' ? 0.4 : 0.28);
  }

  return { load, resume, play, playEvents };
}
