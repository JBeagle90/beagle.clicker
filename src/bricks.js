// Bone Breaker: a little brick breaker on the Play screen. The corgi's paw paddle bounces a ball
// into rows of dog biscuits. Just for fun: it never gives or takes bones, and the best score is
// kept on this browser only.
const W = 320, H = 240;                       // the board, in canvas units (CSS scales it)
const COLS = 8, ROWS = 4, BW = 36, BH = 14, GAP = 4, TOP = 30;
const PW = 56, PH = 10, PY = H - 20, R = 5;   // paddle size and height, ball radius
const GOLD = { chance: .12, fall: 70, wide: 92, secs: 10 }; // the golden biscuit: how often, how fast, how wide, how long
const BEST = "bc.bricks";
const $ = id => document.getElementById(id);

let cv, ctx, colors, running = false, raf = 0, last = 0;
let paddle, ball, bricks, score, lives, level, best = 0, keys = {};
let drop = null, clock = 0, wideUntil = 0;   // a falling golden biscuit, game time (s), when the wide paw ends
const pw = () => clock < wideUntil ? GOLD.wide : PW;   // the paw's width now

// The page's colour tokens, read again at each start so dark mode looks right.
function readColors() {
  const s = getComputedStyle(document.documentElement), v = n => s.getPropertyValue(n).trim();
  return { bg: v("--bg"), ink: v("--ink"), muted: v("--muted"), accent: v("--accent"), cream: v("--cream"), brown: v("--brown"), tan: v("--tan") };
}
const BISCUITS = ["#f2a1b8", "#f6c35b", "#8fd18a", "#8cc4f0"]; // one soft colour a row

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
  const w = pw();
  if (w > PW) {                               // a wide paw: a golden rim, and a bar that shrinks as it runs out
    round(paddle.x - w / 2 - 2, PY - 2, w + 4, PH + 4, 7, "#f5c518");
    round(paddle.x - w / 2, PY + PH + 4, w * (wideUntil - clock) / GOLD.secs, 2, 1, "#f5c518");
  }
  round(paddle.x - w / 2, PY, w, PH, 5, colors.accent);
  ctx.font = "9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("🐾", paddle.x, PY + PH / 2 + 1);
  tennis(ball.x, ball.y, R);
  for (let i = 0; i < lives; i++) tennis(W - 12 - i * 14, 14, 4.5);   // balls left
  ctx.fillStyle = colors.ink; ctx.font = "bold 12px sans-serif"; ctx.textBaseline = "top";
  ctx.textAlign = "left"; ctx.fillText(`🦴 ${score}`, 8, 8);
  ctx.textAlign = "center"; ctx.fillText(`Level ${level}`, W / 2, 8);
}
function goldBiscuit(x, y) {
  round(x - 11, y - 6, 22, 12, 4, "#f5c518");
  ctx.strokeStyle = "#c08a00"; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = "rgba(0,0,0,.2)";
  ctx.beginPath(); ctx.arc(x - 4, y, 1.3, 0, 7); ctx.arc(x + 4, y, 1.3, 0, 7); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x + 8, y - 3, 1.4, 0, 7); ctx.fill();   // a little shine
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
  if (keys.ArrowLeft) paddle.x -= 260 * dt;
  if (keys.ArrowRight) paddle.x += 260 * dt;
  paddle.x = Math.max(pw() / 2, Math.min(W - pw() / 2, paddle.x));
  // The golden biscuit falls: catch it on the paw for a wider paw.
  if (drop) {
    drop.y += GOLD.fall * dt;
    if (drop.y + 6 >= PY && drop.y - 6 < PY + PH && Math.abs(drop.x - paddle.x) <= pw() / 2 + 11) { wideUntil = clock + GOLD.secs; drop = null; }
    else if (drop.y - 6 > H) drop = null;
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
  }
  for (const b of bricks) {
    if (!b.on || ball.x + R < b.x || ball.x - R > b.x + BW || ball.y + R < b.y || ball.y - R > b.y + BH) continue;
    b.on = false; score += 10;
    if (!drop && Math.random() < GOLD.chance) drop = { x: b.x + BW / 2, y: b.y + BH / 2 };
    const fromSide = Math.min(ball.x + R - b.x, b.x + BW - (ball.x - R)) < Math.min(ball.y + R - b.y, b.y + BH - (ball.y - R));
    if (fromSide) ball.vx = -ball.vx; else ball.vy = -ball.vy;
    break;
  }
  if (bricks.every(b => !b.on)) { level++; drop = null; newBricks(); serve(); return; }
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
  if (ball.stuck) message("", "Tap or press Space to throw the ball");
  raf = requestAnimationFrame(loop);
}
function showBest() { $("bricks-best").textContent = best ? `Best: ${best}` : ""; }

// --- Starting, pausing and controls ---
function start() {
  colors = readColors();
  paddle = { x: W / 2 }; score = 0; lives = 3; level = 1; drop = null; clock = wideUntil = 0;
  newBricks(); serve(); running = true;
  $("bricks-go").textContent = "Restart"; cv.focus();
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
  showBest();
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
