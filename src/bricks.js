// Bone Breaker: a little brick breaker on the Play screen. The corgi's paw paddle bounces a ball
// into rows of dog biscuits. Just for fun: it never gives or takes bones, and the best score is
// kept on this browser only.
const W = 320, H = 240;                       // the board, in canvas units (CSS scales it)
const COLS = 8, ROWS = 4, BW = 36, BH = 14, GAP = 4, TOP = 30;
const PW = 56, PH = 10, PY = H - 20, R = 5;   // paddle size and height, ball radius
const GOLD = { chance: .12, fall: 70, wide: 92, secs: 10 }; // the golden biscuit: how often, how fast, how wide, how long
const CONFETTI = { count: 40, speed: 140, gravity: 220, secs: 1.6 }; // the burst when a level is cleared
const WIGGLE = { secs: .35, turns: 2, tilt: .45, dip: 2 }; // the paw's happy wiggle at each bounce: how long, how many wags, how far
const OOPS = { text: "My hot dog!", secs: 1.4, pitch: 1.7, rate: 1.15 }; // a missed golden biscuit: the shout, how long it shows, its voice
const BOING = { from: 180, to: 420, wobble: 14, secs: .22, volume: .12 }; // the paw's soft bounce sound: pitch slide (Hz), its wobble, how long, how loud
const CRUNCH = { secs: .09, freq: 1600, volume: .22 }; // a biscuit breaking: how long, the crunch's pitch (Hz), how loud
const TUNE = { notes: [523, 659, 784, 659, 784, 1047], beat: .11, last: .35, volume: .09 }; // the level-cleared tune: notes (Hz, C E G E G C), each beat (s), the last note's length, how loud
const BEST = "bc.bricks", SOUND = "bc.bricksSound";
const $ = id => document.getElementById(id);

let cv, ctx, colors, running = false, raf = 0, last = 0;
let paddle, ball, bricks, score, lives, level, best = 0, keys = {};
let drop = null, clock = 0, wideUntil = 0;   // a falling golden biscuit, game time (s), when the wide paw ends
let confetti = [], cheerUntil = 0;           // confetti pieces, and when the "Level n!" cheer ends
let wiggleUntil = 0;                         // when the paw's bounce wiggle ends
let oops = null, sound = true;               // the "My hot dog!" bubble ({ x, until }), and whether it's said out loud
let audio = null;                            // the Web Audio context for the boing and crunch, made at the first sound
const pw = () => clock < wideUntil ? GOLD.wide : PW;   // the paw's width now

// The page's colour tokens, read again at each start so dark mode looks right.
function readColors() {
  const s = getComputedStyle(document.documentElement), v = n => s.getPropertyValue(n).trim();
  return { bg: v("--bg"), ink: v("--ink"), muted: v("--muted"), accent: v("--accent"), cream: v("--cream"), brown: v("--brown"), tan: v("--tan") };
}
const BISCUITS = ["#f2a1b8", "#f6c35b", "#8fd18a", "#8cc4f0"]; // one soft colour a row
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// A level is cleared: confetti bursts out where the last biscuit was (just the cheer when motion is reduced).
function burst(x, y) {
  cheerUntil = clock + CONFETTI.secs + .4;
  if (calm()) return;
  for (let i = 0; i < CONFETTI.count; i++) {
    const a = Math.random() * Math.PI * 2, v = CONFETTI.speed * (.4 + Math.random() * .8);
    confetti.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, turn: Math.random() * 6, spin: (Math.random() - .5) * 14,
      color: [...BISCUITS, "#f5c518"][i % 5], end: clock + CONFETTI.secs * (.7 + Math.random() * .3) });
  }
}
function moveConfetti(dt) {
  for (const c of confetti) { c.x += c.vx * dt; c.y += c.vy * dt; c.vy += CONFETTI.gravity * dt; c.vx *= 1 - dt; c.turn += c.spin * dt; }
  confetti = confetti.filter(c => clock < c.end && c.y < H + 6);
}

function newBricks() {
  const left = (W - COLS * BW - (COLS - 1) * GAP) / 2;
  bricks = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) bricks.push({ x: left + c * (BW + GAP), y: TOP + r * (BH + GAP), row: r, on: true });
}
function serve() {
  const speed = 150 + level * 25;            // a little faster each level
  ball = { x: paddle.x, y: PY - R - 1, vx: speed * (Math.random() < .5 ? -.6 : .6), vy: -speed * .8, stuck: true };
}

// --- Drawing ---
function round(x, y, w, h, r, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
function draw() {
  ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, W, H);
  for (const b of bricks) if (b.on) {
    round(b.x, b.y, BW, BH, 5, BISCUITS[b.row]);
    ctx.fillStyle = "rgba(0,0,0,.18)";       // two little dots, like a biscuit
    ctx.beginPath(); ctx.arc(b.x + BW / 2 - 6, b.y + BH / 2, 1.5, 0, 7); ctx.arc(b.x + BW / 2 + 6, b.y + BH / 2, 1.5, 0, 7); ctx.fill();
  }
  if (drop) goldBiscuit(drop.x, drop.y);
  if (oops && clock < oops.until) bubble(oops.x, Math.min(1, (oops.until - clock) * 3));
  for (const c of confetti) {                 // little paper pieces, fading as they end
    ctx.save(); ctx.globalAlpha = Math.min(1, (c.end - clock) * 3);
    ctx.translate(c.x, c.y); ctx.rotate(c.turn); ctx.fillStyle = c.color; ctx.fillRect(-3, -1.5, 6, 3);
    ctx.restore();
  }
  const w = pw();
  if (w > PW) {                               // a wide paw: a golden rim, and a bar that shrinks as it runs out
    round(paddle.x - w / 2 - 2, PY - 2, w + 4, PH + 4, 7, "#f5c518");
    round(paddle.x - w / 2, PY + PH + 4, w * (wideUntil - clock) / GOLD.secs, 2, 1, "#f5c518");
  }
  paw(w);
  tennis(ball.x, ball.y, R);
  for (let i = 0; i < lives; i++) tennis(W - 12 - i * 14, 14, 4.5);   // balls left
  ctx.fillStyle = colors.ink; ctx.font = "bold 12px sans-serif"; ctx.textBaseline = "top";
  ctx.textAlign = "left"; ctx.fillText(`🦴 ${score}`, 8, 8);
  ctx.textAlign = "center"; ctx.fillText(`Level ${level}`, W / 2, 8);
}
// The paw paddle. Just after a bounce it dips a little and its 🐾 wags side to side, a bit bigger.
function paw(w) {
  const left = Math.max(0, wiggleUntil - clock) / WIGGLE.secs;   // 1 right at the bounce, down to 0
  const wag = Math.sin((1 - left) * Math.PI * 2 * WIGGLE.turns) * WIGGLE.tilt * left;
  const y = PY + (left > 0 ? Math.sin((1 - left) * Math.PI) * WIGGLE.dip : 0);
  round(paddle.x - w / 2, y, w, PH, 5, colors.accent);
  ctx.save(); ctx.translate(paddle.x, y + PH / 2 + 1); ctx.rotate(wag); ctx.scale(1 + left * .4, 1 + left * .4);
  ctx.font = "9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("🐾", 0, 0);
  ctx.restore();
}
function goldBiscuit(x, y) {
  round(x - 11, y - 6, 22, 12, 4, "#f5c518");
  ctx.strokeStyle = "#c08a00"; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = "rgba(0,0,0,.2)";
  ctx.beginPath(); ctx.arc(x - 4, y, 1.3, 0, 7); ctx.arc(x + 4, y, 1.3, 0, 7); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x + 8, y - 3, 1.4, 0, 7); ctx.fill();   // a little shine
}
// "My hot dog!" in a little speech bubble just above the paw, fading as it ends.
function bubble(x, alpha) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.font = "bold 11px sans-serif";
  const w = ctx.measureText(OOPS.text).width + 14, bx = Math.max(2, Math.min(W - w - 2, x - w / 2)), by = PY - 34;
  round(bx, by, w, 18, 9, colors.cream);
  ctx.strokeStyle = colors.brown; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = colors.brown; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(OOPS.text, bx + w / 2, by + 9.5);
  ctx.restore();
}
// The golden biscuit got away: the corgi shouts "My hot dog!" (out loud only when sound is on).
function missed(x) {
  oops = { x, until: clock + OOPS.secs };
  if (!sound || !window.speechSynthesis) return;
  const say = new SpeechSynthesisUtterance(OOPS.text);
  say.pitch = OOPS.pitch; say.rate = OOPS.rate;
  speechSynthesis.cancel(); speechSynthesis.speak(say);
}
// The one Web Audio context, made when first needed (null when sound is off or the browser has none).
function ears() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!sound || !AC) return null;
  audio = audio || new AC();
  if (audio.state === "suspended") audio.resume();
  return audio;
}
// A soft "boing" when the ball bounces off the paw (only when sound is on): a gentle sine wave that
// slides up in pitch with a little wobble, fading out fast.
function boing() {
  try {
    if (!ears()) return;
    const t = audio.currentTime, osc = audio.createOscillator(), lfo = audio.createOscillator();
    const wob = audio.createGain(), vol = audio.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(BOING.from, t);
    osc.frequency.exponentialRampToValueAtTime(BOING.to, t + BOING.secs);
    lfo.frequency.value = 30; wob.gain.value = BOING.wobble;   // the springy wobble
    lfo.connect(wob); wob.connect(osc.frequency);
    vol.gain.setValueAtTime(0.0001, t);
    vol.gain.exponentialRampToValueAtTime(BOING.volume, t + .015);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + BOING.secs);
    osc.connect(vol); vol.connect(audio.destination);
    osc.start(t); lfo.start(t); osc.stop(t + BOING.secs + .02); lfo.stop(t + BOING.secs + .02);
  } catch (e) { /* no sound here: the game goes on */ }
}
// A little "crunch" when a biscuit breaks (only when sound is on): a short burst of crackly noise
// through a filter, pitched a bit differently each time.
function crunch() {
  try {
    if (!ears()) return;
    const t = audio.currentTime, n = Math.floor(audio.sampleRate * CRUNCH.secs);
    const buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {             // noise in loud and soft little bits, fading out
      const crackle = Math.floor(i * 6 / n) % 2 ? .45 : 1;
      d[i] = (Math.random() * 2 - 1) * crackle * (1 - i / n);
    }
    const src = audio.createBufferSource(), band = audio.createBiquadFilter(), vol = audio.createGain();
    src.buffer = buf;
    band.type = "bandpass"; band.Q.value = 1.2; band.frequency.value = CRUNCH.freq * (.8 + Math.random() * .4);
    vol.gain.value = CRUNCH.volume;
    src.connect(band); band.connect(vol); vol.connect(audio.destination);
    src.start(t);
  } catch (e) { /* no sound here: the game goes on */ }
}
// A cheerful little tune when a level is cleared (only when sound is on): six bright, bell-like
// notes climbing up, the last one held a little longer.
function tune() {
  try {
    if (!ears()) return;
    const start = audio.currentTime + .05;
    TUNE.notes.forEach((freq, i) => {
      const t = start + i * TUNE.beat, len = i === TUNE.notes.length - 1 ? TUNE.last : TUNE.beat * 1.4;
      const osc = audio.createOscillator(), vol = audio.createGain();
      osc.type = "triangle"; osc.frequency.value = freq;
      vol.gain.setValueAtTime(0.0001, t);
      vol.gain.exponentialRampToValueAtTime(TUNE.volume, t + .012);   // a soft "ting" at the start
      vol.gain.exponentialRampToValueAtTime(0.0001, t + len);         // then fading away
      osc.connect(vol); vol.connect(audio.destination);
      osc.start(t); osc.stop(t + len + .02);
    });
  } catch (e) { /* no sound here: the game goes on */ }
}
function tennis(x, y, r) {
  ctx.fillStyle = "#c9e04a"; ctx.strokeStyle = "#7c9a1e"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
}
function message(big, small) {
  ctx.fillStyle = colors.ink; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "bold 20px sans-serif"; ctx.fillText(big, W / 2, H / 2 + 10);
  ctx.fillStyle = colors.muted; ctx.font = "12px sans-serif"; ctx.fillText(small, W / 2, H / 2 + 34);
}

// --- Moving: the paddle, the ball, bounces and biscuits ---
function step(dt) {
  clock += dt;
  moveConfetti(dt);
  if (keys.ArrowLeft) paddle.x -= 260 * dt;
  if (keys.ArrowRight) paddle.x += 260 * dt;
  paddle.x = Math.max(pw() / 2, Math.min(W - pw() / 2, paddle.x));
  // The golden biscuit falls: catch it on the paw for a wider paw.
  if (drop) {
    drop.y += GOLD.fall * dt;
    if (drop.y + 6 >= PY && drop.y - 6 < PY + PH && Math.abs(drop.x - paddle.x) <= pw() / 2 + 11) { wideUntil = clock + GOLD.secs; drop = null; }
    else if (drop.y - 6 > H) { missed(drop.x); drop = null; }
  }
  if (ball.stuck) { ball.x = paddle.x; return; }
  ball.x += ball.vx * dt; ball.y += ball.vy * dt;
  if (ball.x < R) { ball.x = R; ball.vx = Math.abs(ball.vx); }
  if (ball.x > W - R) { ball.x = W - R; ball.vx = -Math.abs(ball.vx); }
  if (ball.y < R) { ball.y = R; ball.vy = Math.abs(ball.vy); }
  // The paddle: where it lands sets the angle, so players can aim.
  if (ball.vy > 0 && ball.y + R >= PY && ball.y < PY + PH && Math.abs(ball.x - paddle.x) <= pw() / 2 + R) {
    const speed = Math.hypot(ball.vx, ball.vy), hit = (ball.x - paddle.x) / (pw() / 2);
    ball.vx = speed * Math.max(-.85, Math.min(.85, hit * .85));
    ball.vy = -Math.sqrt(speed * speed - ball.vx * ball.vx);
    ball.y = PY - R;
    if (!calm()) wiggleUntil = clock + WIGGLE.secs;   // a happy little wiggle (none when motion is reduced)
    boing();
  }
  let broke = null;
  for (const b of bricks) {
    if (!b.on || ball.x + R < b.x || ball.x - R > b.x + BW || ball.y + R < b.y || ball.y - R > b.y + BH) continue;
    b.on = false; score += 10; broke = b;
    crunch();
    if (!drop && Math.random() < GOLD.chance) drop = { x: b.x + BW / 2, y: b.y + BH / 2 };
    const fromSide = Math.min(ball.x + R - b.x, b.x + BW - (ball.x - R)) < Math.min(ball.y + R - b.y, b.y + BH - (ball.y - R));
    if (fromSide) ball.vx = -ball.vx; else ball.vy = -ball.vy;
    break;
  }
  if (broke && bricks.every(b => !b.on)) { burst(broke.x + BW / 2, broke.y + BH / 2); tune(); level++; drop = null; newBricks(); serve(); return; }
  if (ball.y - R > H) {
    lives--;
    drop = null;
    if (lives > 0) serve(); else over();
  }
}
function over() {
  running = false;
  if (score > best) { best = score; try { localStorage.setItem(BEST, String(best)); } catch (e) { /* private mode */ } }
  draw(); message("Good boy! 🐶", `Score ${score}. Press Play to go again.`);
  showBest(); $("bricks-go").textContent = "Play again";
}
function loop(t) {
  const dt = Math.min(.03, (t - last) / 1000); last = t;
  if (!running) return;
  step(dt); draw();
  if (ball.stuck) message(clock < cheerUntil ? `Level ${level}! 🎉` : "", "Tap or press Space to throw the ball");
  raf = requestAnimationFrame(loop);
}
function showBest() { $("bricks-best").textContent = best ? `Best: ${best}` : ""; }
// The sound button: 🔊 or 🔇, kept on this browser.
function showSound() {
  const b = $("bricks-sound");
  b.textContent = sound ? "🔊" : "🔇"; b.setAttribute("aria-pressed", String(sound));
  b.title = sound ? "Sound on" : "Sound off";
}

// --- Starting, pausing and controls ---
function start() {
  colors = readColors();
  paddle = { x: W / 2 }; score = 0; lives = 3; level = 1; drop = null; clock = wideUntil = cheerUntil = wiggleUntil = 0; confetti = []; oops = null;
  newBricks(); serve(); running = true;  $("bricks-go").textContent = "Restart"; cv.focus();
  cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(loop);
}
const throwBall = () => { if (running && ball.stuck) ball.stuck = false; };

// Called when the screen changes: leaving Play pauses (the ball waits on the paddle).
export function showBricks(on) {
  if (!cv) return;
  if (!on && running) { cancelAnimationFrame(raf); ball.stuck = true; ball.y = PY - R - 1; keys = {}; }
  if (on && running) { last = performance.now(); raf = requestAnimationFrame(loop); }
  if (on && !running && !paddle) { colors = readColors(); paddle = { x: W / 2 }; score = 0; lives = 3; level = 1; newBricks(); serve(); draw(); message("Bone Breaker", "Press Play to start"); }
}

export function setupBricks() {
  cv = $("bricks"); ctx = cv.getContext("2d");
  const ratio = Math.min(3, window.devicePixelRatio || 1);
  cv.width = W * ratio; cv.height = H * ratio; ctx.scale(ratio, ratio);
  try { best = +localStorage.getItem(BEST) || 0; } catch (e) { /* private mode */ }
  try { sound = localStorage.getItem(SOUND) !== "off"; } catch (e) { /* private mode */ }
  showBest(); showSound();
  $("bricks-sound").addEventListener("click", () => {
    sound = !sound; showSound();
    if (!sound && window.speechSynthesis) speechSynthesis.cancel();
    try { localStorage.setItem(SOUND, sound ? "on" : "off"); } catch (e) { /* private mode */ }
  });
  $("bricks-go").addEventListener("click", start);
  const aim = e => { if (!running) return; const r = cv.getBoundingClientRect(); paddle.x = (e.clientX - r.left) / r.width * W; };
  cv.addEventListener("pointermove", aim);
  cv.addEventListener("pointerdown", e => { aim(e); throwBall(); });
  cv.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { keys[e.key] = true; e.preventDefault(); }
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (running) throwBall(); else start(); }
  });
  cv.addEventListener("keyup", e => { keys[e.key] = false; });
  cv.addEventListener("blur", () => { keys = {}; });
}
