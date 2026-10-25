// Win celebration: a confetti burst drawn on a temporary full-screen canvas, and a short
// chime synthesized with Web Audio (no sound files to ship).

const COLORS = ["#e23aa6", "#3fbf7f", "#e0b13a", "#4f8fe8", "#ffffff", "#ff7a45"];
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  angle: number;
  w: number;
  h: number;
  color: string;
  flutter: number;
}

/** Fire confetti outward from the centre of `from`. */
export function confetti(from: DOMRect) {
  if (reducedMotion()) return;
  const canvas = document.createElement("canvas");
  canvas.className = "confetti";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  const dpr = Math.min(devicePixelRatio, 2);
  const resize = () => {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
  };
  resize();
  addEventListener("resize", resize);
  const ctx = canvas.getContext("2d")!;

  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  const pieces: Piece[] = [];
  const burst = (count: number, power: number) => {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = power * (0.35 + Math.random() * 0.65);
      pieces.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - power * 0.35, // bias upward so it arcs like a popper
        spin: (Math.random() - 0.5) * 0.4,
        angle: Math.random() * Math.PI,
        w: 6 + Math.random() * 6,
        h: 3 + Math.random() * 4,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        flutter: Math.random() * Math.PI * 2,
      });
    }
  };
  burst(140, 16);
  setTimeout(() => burst(80, 12), 180);

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(2, (now - last) / 16.67); // in 60fps frames
    last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of pieces) {
      p.vx *= 0.985 ** dt;
      p.vy = p.vy * 0.985 ** dt + 0.32 * dt;
      p.flutter += 0.12 * dt;
      p.x += (p.vx + Math.sin(p.flutter) * 0.8) * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.scale(1, Math.cos(p.flutter)); // tumble: the strip flips as it falls
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    for (let i = pieces.length - 1; i >= 0; i--) if (pieces[i].y > innerHeight + 40) pieces.splice(i, 1);
    if (pieces.length) requestAnimationFrame(frame);
    else {
      removeEventListener("resize", resize);
      canvas.remove();
    }
  };
  requestAnimationFrame(frame);
}

// ---- Sound ------------------------------------------------------------------------

const MUTE_KEY = "texturdle:muted";
let audio: AudioContext | null = null;

export function isMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Not saved; the toggle still works for this visit.
  }
}

/** A confetti pop followed by a rising major arpeggio. Call from a click so audio is allowed. */
export function winSound() {
  if (isMuted()) return;
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    return;
  }
  const ac = audio;
  const t0 = ac.currentTime + 0.02;
  const master = ac.createGain();
  master.gain.value = 0.35;
  master.connect(ac.destination);

  // Pop: a short burst of filtered noise.
  const noise = ac.createBuffer(1, ac.sampleRate * 0.12, ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  const pop = ac.createBufferSource();
  pop.buffer = noise;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1800;
  band.Q.value = 0.8;
  pop.connect(band).connect(master);
  pop.start(t0);

  // Chime: C5 E5 G5 C6, then a soft C major chord underneath.
  const note = (freq: number, at: number, len: number, type: OscillatorType, vol: number) => {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    osc.connect(g).connect(master);
    osc.start(at);
    osc.stop(at + len + 0.05);
  };
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    note(f, t0 + 0.08 + i * 0.09, 0.5, "triangle", 0.5);
    note(f * 2, t0 + 0.08 + i * 0.09, 0.25, "sine", 0.12); // a little sparkle on top
  });
  for (const f of [523.25, 659.25, 783.99]) note(f, t0 + 0.45, 1.1, "sine", 0.18);
}
