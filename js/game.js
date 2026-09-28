"use strict";
/* Moon Pioneer — idle colony arcade.
   Gather oil -> refine into blocks -> build collectors, treadmills,
   greenhouses, helpers -> launch rockets to new planets. */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = 960, H = 600;
const DPR = Math.min(2, window.devicePixelRatio || 1);
canvas.width = Math.round(W * DPR);
canvas.height = Math.round(H * DPR);

/* ---------------- Helpers ---------------- */
function mulberry(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let z = Math.imul(t ^ (t >>> 15), 1 | t);
    z ^= z + Math.imul(z ^ (z >>> 7), 61 | z);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}
function rr(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function d2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

/* ---------------- Audio ---------------- */
let AC = null;
function beep(freq, dur = 0.1, type = "square", vol = 0.04, slideTo = 0) {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = freq;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, AC.currentTime + dur);
    g.gain.value = vol;
    o.connect(g); g.connect(AC.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    o.stop(AC.currentTime + dur);
  } catch (e) {}
}

/* ---------------- Planets ---------------- */
const PLANETS = [
  { name: "MOON",   ground: ["#a8a8b2", "#7c7c88"], dark: "#5b5b66", oilMult: 1,   rocketCost: 150, poolSeed: 11 },
  { name: "MARS",   ground: ["#c07a52", "#8f4e38"], dark: "#6e3a28", oilMult: 2,   rocketCost: 400, poolSeed: 47 },
  { name: "EUROPA", ground: ["#c3d8ec", "#8fa9c4"], dark: "#6d87a3", oilMult: 3.5, rocketCost: 0,   poolSeed: 83 },
];

/* ---------------- State ---------------- */
let state = "menu"; // menu | playing | launch | victory
let planetIdx = 0;
let sol = 1, solTimer = 0;
let blocks = 20, food = 6;
let carryCap = 10, playerSpeed = 170;
let backpackLvl = 0, bootsLvl = 0;
let buyCount = { collector: 0, treadmill: 0, greenhouse: 0, helper: 0 };
let launchT = 0, finalLaunch = false;

const BASE_COST = { collector: 30, treadmill: 40, greenhouse: 50, helper: 60, backpack: 25, boots: 25 };
function costOf(kind) {
  if (kind === "backpack") return backpackLvl >= 3 ? -1 : Math.round(BASE_COST.backpack * Math.pow(1.8, backpackLvl));
  if (kind === "boots") return bootsLvl >= 2 ? -1 : Math.round(BASE_COST.boots * Math.pow(1.8, bootsLvl));
  if (kind === "helper") return buyCount.helper >= 4 ? -1 : Math.round(BASE_COST.helper * Math.pow(1.6, buyCount.helper));
  return Math.round(BASE_COST[kind] * Math.pow(1.6, buyCount[kind]));
}

// fixed plot layout (per planet, same slots)
const PLOTS = [
  { kind: "collector",  x: 250, y: 190, building: null },
  { kind: "collector",  x: 250, y: 430, building: null },
  { kind: "collector",  x: 110, y: 310, building: null },
  { kind: "treadmill",  x: 440, y: 310, building: null },
  { kind: "treadmill",  x: 640, y: 470, building: null },
  { kind: "greenhouse", x: 610, y: 175, building: null },
];
const REFINERY = { x: 700, y: 330, oilBuf: 0, prog: 0 };
const ROCKET = { x: 855, y: 490 };

const player = { x: 480, y: 300, vx: 0, vy: 0, dir: 0, carry: 0, gatherT: 0, moving: false };
const helpers = []; // {x,y,tx,ty,carry,state,t,wait}
const pools = [];   // {x,y,r}
const parts = [];   // particles

function resetColony(keepBlocks) {
  const P = PLANETS[planetIdx];
  if (!keepBlocks) blocks = 20;
  food = 6;
  player.x = 480; player.y = 300; player.carry = 0; player.vx = 0; player.vy = 0;
  helpers.length = 0; parts.length = 0;
  for (const p of PLOTS) p.building = null;
  buyCount = { collector: 0, treadmill: 0, greenhouse: 0, helper: 0 };
  REFINERY.oilBuf = 0; REFINERY.prog = 0;
  pools.length = 0;
  const r = mulberry(P.poolSeed);
  const spots = [[150, 120], [820, 150], [140, 520], [560, 500], [830, 380]];
  for (let i = 0; i < 3; i++) {
    const s = spots[Math.floor(r() * spots.length)];
    pools.push({ x: s[0] + (r() - 0.5) * 60, y: s[1] + (r() - 0.5) * 60, r: 46 + r() * 22 });
  }
  document.getElementById("planetName").textContent = P.name;
}

/* ---------------- Input ---------------- */
const keys = {};
addEventListener("keydown", e => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
  if (k === "enter" && state === "menu") startGame();
});
addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });

function startGame() {
  planetIdx = 0; sol = 1; carryCap = 10; playerSpeed = 170;
  backpackLvl = 0; bootsLvl = 0;
  resetColony(false);
  state = "playing";
  document.getElementById("overlay").classList.remove("show");
  document.getElementById("buildbar").classList.remove("hidden");
  toast("Welcome, pioneer. Gather oil!", 2200);
  refreshBuildbar();
}
document.getElementById("startBtn").addEventListener("click", startGame);

let toastTimer = null;
function toast(msg, ms = 0) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.toggle("show", !!msg);
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

/* click a helper to switch ferry <-> treadmill duty */
canvas.addEventListener("click", e => {
  if (state !== "playing") return;
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (W / r.width);
  const y = (e.clientY - r.top) * (H / r.height);
  for (const h of helpers) {
    if (d2(x, y, h.x, h.y) < 28 * 28) { toggleHelper(h); break; }
  }
});
function toggleHelper(h) {
  if (h.st === "tired") { toast("Too exhausted — feed them first!", 1500); return; }
  h.mode = h.mode === "run" ? "ferry" : "run";
  h.runnerPlot = null;
  h.carry = 0;
  h.st = h.mode === "run" ? "torun" : "seek";
  beep(h.mode === "run" ? 700 : 500, 0.08, "square", 0.04);
  toast(h.mode === "run" ? "Helper → treadmill duty" : "Helper → ferry duty", 1400);
}

/* ---------------- Particles ---------------- */
function puff(x, y, n, col, spd = 90, life = 0.6, size = 4) {
  for (let i = 0; i < n; i++) {
    if (parts.length > 350) parts.shift();
    const a = Math.random() * Math.PI * 2, s = spd * (0.4 + Math.random());
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: life * (0.6 + Math.random() * 0.8), max: life, size: size * (0.6 + Math.random() * 0.8), col });
  }
}

/* ---------------- Building / buying ---------------- */
function buy(kind) {
  if (state !== "playing") return false;
  const cost = kind === "rocket" ? PLANETS[planetIdx].rocketCost : costOf(kind);
  if (cost < 0 || blocks < cost) { beep(160, 0.12, "square", 0.05); return false; }

  if (kind === "rocket") {
    finalLaunch = PLANETS[planetIdx].rocketCost <= 0;
    launchRocket();
    return true;
  }
  if (kind === "backpack") { backpackLvl++; carryCap += 5; }
  else if (kind === "boots") { bootsLvl++; playerSpeed += 35; }
  else if (kind === "helper") {
    buyCount.helper++;
    helpers.push({ x: REFINERY.x - 40, y: REFINERY.y + 40, tx: 0, ty: 0, carry: 0,
      st: "seek", t: 0, wait: 0, energy: 100, mode: "ferry", runnerPlot: null, zt: 0 });
  } else {
    const plot = PLOTS.find(p => p.kind === kind && !p.building);
    if (!plot) return false;
    buyCount[kind]++;
    plot.building = kind === "collector" ? { oil: 0, t: 0 }
      : kind === "greenhouse" ? { t: 0 }
      : {};
    puff(plot.x, plot.y, 14, "255,176,61");
  }
  blocks -= cost;
  beep(660, 0.1, "square", 0.05, 990);
  toast(`${kind[0].toUpperCase() + kind.slice(1)} built!`, 1200);
  refreshBuildbar();
  return true;
}
document.querySelectorAll("#buildbar button").forEach(b =>
  b.addEventListener("click", () => buy(b.dataset.buy)));

function refreshBuildbar() {
  document.querySelectorAll("#buildbar button").forEach(b => {
    const kind = b.dataset.buy;
    const label = b.querySelector("span");
    if (kind === "rocket") {
      const c = PLANETS[planetIdx].rocketCost;
      if (c <= 0) { label.textContent = "FINISH"; b.disabled = state !== "playing"; b.classList.remove("maxed"); }
      else { label.textContent = `${c} ▦`; b.disabled = blocks < c || state !== "playing"; b.classList.remove("maxed"); }
      return;
    }
    const c = costOf(kind);
    if (c < 0) { label.textContent = "MAX"; b.disabled = true; b.classList.add("maxed"); }
    else {
      const noPlot = (kind === "collector" || kind === "treadmill" || kind === "greenhouse") &&
        !PLOTS.some(p => p.kind === kind && !p.building);
      label.textContent = `${c} ▦`;
      b.disabled = blocks < c || noPlot || state !== "playing";
      b.classList.remove("maxed");
    }
  });
}

function launchRocket() {
  const c = PLANETS[planetIdx].rocketCost;
  blocks -= c;
  state = "launch";
  launchT = 0;
  beep(120, 1.6, "sawtooth", 0.08, 900);
  document.getElementById("buildbar").classList.add("hidden");
}

/* ---------------- Update ---------------- */
function update(dt, t) {
  if (state === "launch") {
    launchT += dt;
    if (Math.random() < 0.6) puff(ROCKET.x, ROCKET.y + 46, 3, "255,170,80", 160, 0.5, 6);
    if (launchT > 2.4) {
      if (finalLaunch || planetIdx >= PLANETS.length - 1) { onVictory(); return; }
      planetIdx++;
      carryCap = 10 + backpackLvl * 5;
      resetColony(true);
      state = "playing";
      document.getElementById("buildbar").classList.remove("hidden");
      toast(`Welcome to ${PLANETS[planetIdx].name} — richer oil fields!`, 2600);
      refreshBuildbar();
    }
    updateParts(dt);
    return;
  }
  if (state !== "playing") { updateParts(dt); return; }

  const P = PLANETS[planetIdx];
  solTimer += dt;
  if (solTimer > 60) { solTimer = 0; sol++; }

  /* --- player movement --- */
  let mx = ((keys["arrowright"] || keys["d"]) ? 1 : 0) - ((keys["arrowleft"] || keys["a"]) ? 1 : 0);
  let my = ((keys["arrowdown"] || keys["s"]) ? 1 : 0) - ((keys["arrowup"] || keys["w"]) ? 1 : 0);
  player.moving = !!(mx || my);
  if (player.moving) {
    const l = Math.hypot(mx, my); mx /= l; my /= l;
    player.dir = Math.atan2(my, mx);
  }
  const spd = playerSpeed * (player.carry >= carryCap ? 0.85 : 1);
  player.x = clamp(player.x + mx * spd * dt, 30, W - 30);
  player.y = clamp(player.y + my * spd * dt, 60, H - 90);

  /* --- gather oil from pools --- */
  player.gatherT -= dt;
  if (player.carry < carryCap && player.gatherT <= 0) {
    for (const p of pools) {
      if (d2(player.x, player.y, p.x, p.y) < (p.r + 14) * (p.r + 14)) {
        player.carry++;
        player.gatherT = 0.22;
        puff(p.x + (Math.random() - 0.5) * 30, p.y + (Math.random() - 0.5) * 20, 2, "120,60,180", 60, 0.4, 3);
        if (player.carry % 5 === 0) beep(440 + player.carry * 20, 0.06, "square", 0.03);
        break;
      }
    }
  }

  /* --- deposit at refinery --- */
  if (player.carry > 0 && d2(player.x, player.y, REFINERY.x, REFINERY.y) < 80 * 80) {
    const n = Math.min(player.carry, Math.ceil(30 * dt) || 1);
    player.carry -= n; REFINERY.oilBuf += n;
    puff(REFINERY.x, REFINERY.y - 20, 2, "125,215,252", 60, 0.4, 3);
    if (Math.random() < 0.2) beep(720, 0.05, "square", 0.03);
  }

  /* --- treadmill power: helpers physically run on treadmills --- */
  const builtTreads = PLOTS.filter(p => p.building && p.kind === "treadmill");
  let runners = 0;
  for (const h of helpers) {
    if (h.mode !== "run" || h.st === "tired") { h.runnerPlot = null; continue; }
    if (!h.runnerPlot || !h.runnerPlot.building) {
      h.runnerPlot = builtTreads.find(p =>
        helpers.filter(o => o !== h && o.runnerPlot === p).length < 2) || null;
      if (!h.runnerPlot) { h.mode = "ferry"; h.st = "seek"; continue; }
    }
    runners++;
  }
  const boost = 1 + runners * 0.5;

  /* --- collectors --- */
  for (const p of PLOTS) {
    if (!p.building || p.kind !== "collector") continue;
    const b = p.building;
    b.t -= dt;
    if (b.t <= 0 && b.oil < 20) {
      b.oil += 1;
      b.t = 3 / (P.oilMult * boost);
      puff(p.x, p.y - 18, 1, "120,60,180", 40, 0.4, 3);
    }
  }

  /* --- refinery: oil -> blocks --- */
  if (REFINERY.oilBuf > 0) {
    REFINERY.prog += dt / 1.6;
    if (REFINERY.prog >= 1) {
      REFINERY.prog = 0;
      REFINERY.oilBuf--;
      blocks++;
      puff(REFINERY.x, REFINERY.y - 44, 4, "255,176,61", 60, 0.6, 4);
      beep(980, 0.08, "square", 0.035, 1240);
      refreshBuildbar();
    }
  } else REFINERY.prog = 0;

  /* --- greenhouse: food --- */
  for (const p of PLOTS) {
    if (!p.building || p.kind !== "greenhouse") continue;
    const b = p.building;
    b.t += dt;
    if (b.t > 5 && food < 30) {
      b.t = 0; food++;
      puff(p.x, p.y - 14, 3, "126,231,135", 50, 0.5, 3);
    }
  }

  /* --- helpers: ferry oil, run treadmills, eat food, get tired --- */
  for (const h of helpers) {
    h.t += dt;
    // stamina: running drains, deliveries cost, food restores
    if (h.st === "running") h.energy -= 4 * dt;
    if (h.energy < 25 && food > 0 && h.st !== "tired") {
      food--; h.energy = Math.min(100, h.energy + 45);
      puff(h.x, h.y - 20, 4, "126,231,135", 50, 0.5, 3);
      beep(600, 0.08, "square", 0.04, 900);
    }
    if (h.energy <= 0) {
      h.energy = 0;
      if (food <= 0 && h.st !== "tired") {
        h.st = "tired"; h.carry = 0; h.runnerPlot = null;
        toast("Helper exhausted — grow food!", 1800);
      }
    }
    if (h.st === "tired") {
      h.zt += dt;
      if (h.zt > 1.4) { h.zt = 0; scorePop(h.x, h.y - 32, "Zzz"); }
      if (food > 0) {
        food--; h.energy = 50;
        h.st = h.mode === "run" ? "torun" : "seek";
        toast("Helper refueled!", 1200);
      }
      continue;
    }
    // treadmill duty
    if (h.mode === "run") {
      if (!h.runnerPlot) { h.mode = "ferry"; h.st = "seek"; }
      else if (moveToward(h, h.runnerPlot.x - 10, h.runnerPlot.y - 4, 150, dt)) h.st = "running";
      else h.st = "torun";
      continue;
    }
    if (h.st === "seek") {
      let bestP = null, bestOil = 0;
      for (const p of PLOTS) {
        if (p.building && p.kind === "collector" && p.building.oil > bestOil) { bestOil = p.building.oil; bestP = p; }
      }
      if (bestP && bestOil >= 3) { h.tx = bestP.x; h.ty = bestP.y + 30; h.plot = bestP; h.st = "go"; }
      else { h.wait += dt; h.tx = REFINERY.x - 40; h.ty = REFINERY.y + 40; h.st = h.wait > 0.5 ? "idle" : "seek"; h.wait = 0; }
    } else if (h.st === "go") {
      if (moveToward(h, h.tx, h.ty, 135, dt)) {
        if (h.plot && h.plot.building) {
          const take = Math.min(6, h.plot.building.oil);
          h.plot.building.oil -= take;
          h.carry = take;
          h.st = "back"; h.tx = REFINERY.x; h.ty = REFINERY.y + 34;
          beep(520, 0.07, "square", 0.03);
        } else h.st = "seek";
      }
    } else if (h.st === "back") {
      if (moveToward(h, h.tx, h.ty, 135, dt)) {
        REFINERY.oilBuf += h.carry;
        scorePop(h.x, h.y - 20, `+${h.carry} oil`);
        h.carry = 0; h.st = "seek";
        h.energy = Math.max(0, h.energy - 15);
        puff(REFINERY.x, REFINERY.y - 20, 3, "255,176,61", 60, 0.4, 3);
        beep(760, 0.07, "square", 0.035);
      }
    } else if (h.st === "idle") {
      moveToward(h, REFINERY.x - 40, REFINERY.y + 40, 100, dt);
      h.wait += dt;
      if (h.wait > 1.2) { h.st = "seek"; h.wait = 0; }
    }
  }

  updateParts(dt);
  updateHUD();

  const tired = helpers.some(h => h.st === "tired");
  const warn = document.getElementById("warn");
  if (tired) { warn.textContent = "HELPERS EXHAUSTED — GROW FOOD"; warn.classList.remove("hidden"); }
  else if (food <= 2 && helpers.length) { warn.textContent = "LOW FOOD"; warn.classList.remove("hidden"); }
  else warn.classList.add("hidden");
}

function moveToward(h, tx, ty, spd, dt) {
  const dx = tx - h.x, dy = ty - h.y, d = Math.hypot(dx, dy);
  if (d < 6) return true;
  h.x += (dx / d) * spd * dt;
  h.y += (dy / d) * spd * dt;
  return false;
}

function updateParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.97; p.vy *= 0.97;
    if (p.life <= 0) parts.splice(i, 1);
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= dt; f.y -= 34 * dt;
    if (f.life <= 0) floaters.splice(i, 1);
  }
}
const floaters = []; // {x,y,txt,life}
function scorePop(x, y, txt) {
  floaters.push({ x, y, txt, life: 1.1 });
  if (floaters.length > 20) floaters.shift();
}

function onVictory() {
  state = "victory";
  document.getElementById("overlay").innerHTML = `<div class="panel">
      <h1 style="font-size:44px">GALAXY <span>PIONEER</span></h1>
      <p class="tag">three worlds colonized &bull; the universe is yours</p>
      <div class="controls"><div>Final blocks: <b class="c-blk">${blocks}</b> &nbsp;•&nbsp; Sol ${sol}</div></div>
      <button id="startBtn">Play Again</button>
    </div>`;
  document.getElementById("overlay").classList.add("show");
  document.getElementById("startBtn").addEventListener("click", () => location.reload());
  beep(523, 0.15, "square", 0.06); setTimeout(() => beep(659, 0.15, "square", 0.06), 150);
  setTimeout(() => beep(784, 0.3, "square", 0.06), 300);
}

/* ---------------- HUD ---------------- */
const el = id => document.getElementById(id);
let lastBlocks = -1;
function updateHUD() {
  const oilTotal = player.carry + REFINERY.oilBuf +
    PLOTS.reduce((s, p) => s + (p.building && p.kind === "collector" ? p.building.oil : 0), 0) +
    helpers.reduce((s, h) => s + h.carry, 0);
  el("oil").textContent = oilTotal;
  el("blocks").textContent = blocks;
  el("food").textContent = food;
  el("sol").textContent = "Sol " + sol;
  if (blocks !== lastBlocks) { lastBlocks = blocks; refreshBuildbar(); }
}

/* ---------------- Rendering ---------------- */
let bgCanvas = null, bgPlanet = -1;
function makeBG() {
  const P = PLANETS[planetIdx];
  bgCanvas = document.createElement("canvas");
  bgCanvas.width = W; bgCanvas.height = H;
  const b = bgCanvas.getContext("2d");
  const g = b.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, P.ground[0]); g.addColorStop(1, P.ground[1]);
  b.fillStyle = g; b.fillRect(0, 0, W, H);
  const r = mulberry(P.poolSeed * 31 + 5);
  for (let i = 0; i < 500; i++) {
    b.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.05)";
    b.beginPath(); b.arc(r() * W, r() * H, 1 + r() * 3, 0, 7); b.fill();
  }
  for (let i = 0; i < 14; i++) { // decorative craters
    const x = r() * W, y = 80 + r() * (H - 160), cr = 12 + r() * 30;
    b.fillStyle = "rgba(0,0,0,0.12)";
    b.beginPath(); b.ellipse(x, y, cr, cr * 0.55, 0, 0, 7); b.fill();
    b.strokeStyle = "rgba(255,255,255,0.10)"; b.lineWidth = 3;
    b.beginPath(); b.ellipse(x, y - 3, cr, cr * 0.55, 0, Math.PI, 2 * Math.PI); b.stroke();
  }
  bgPlanet = planetIdx;
}

function drawAstronaut(x, y, dir, suit, t, moving, carry, scale = 1) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(scale, scale);
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath(); ctx.ellipse(0, 16, 14, 5, 0, 0, 7); ctx.fill();
  const step = moving ? Math.sin(t * 12) * 4 : 0;
  // legs
  ctx.fillStyle = suit === "#fff" ? "#dfe3ec" : "#e08a3c";
  rr(ctx, -9, 6 + step, 7, 10, 3); ctx.fill();
  rr(ctx, 2, 6 - step, 7, 10, 3); ctx.fill();
  // backpack
  ctx.fillStyle = "#8b93a7";
  rr(ctx, -16, -8, 8, 18, 3); ctx.fill();
  // body
  const bg = ctx.createLinearGradient(0, -12, 0, 10);
  bg.addColorStop(0, "#ffffff"); bg.addColorStop(1, suit === "#fff" ? "#c9cfdd" : "#d97f2e");
  ctx.fillStyle = suit === "#fff" ? bg : "#e8933c";
  ctx.beginPath(); ctx.arc(0, -2, 13, 0, 7); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 2; ctx.stroke();
  // helmet + visor (faces dir)
  ctx.fillStyle = "#f4f6fb";
  ctx.beginPath(); ctx.arc(0, -14, 9, 0, 7); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.stroke();
  const vx = Math.cos(dir) * 5, vy = Math.sin(dir) * 3;
  ctx.fillStyle = "#182742";
  ctx.beginPath(); ctx.arc(vx, -14 + vy, 5.5, 0, 7); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath(); ctx.arc(vx - 1.5, -16 + vy, 1.8, 0, 7); ctx.fill();
  // carried barrels
  const n = Math.min(5, carry);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = "#7a3fd1";
    rr(ctx, -12 + i * 6, -34, 5, 7, 1.5); ctx.fill();
    ctx.fillStyle = "#a87fe8"; ctx.fillRect(-12 + i * 6, -34, 5, 2);
  }
  ctx.restore();
}

function drawPool(p, t) {
  const shimmer = 1 + Math.sin(t * 2 + p.x) * 0.03;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath(); ctx.ellipse(p.x, p.y + 6, p.r, p.r * 0.5, 0, 0, 7); ctx.fill();
  const g = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, p.r * shimmer);
  g.addColorStop(0, "#3a1f5d"); g.addColorStop(0.7, "#241239"); g.addColorStop(1, "rgba(20,10,35,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * shimmer, p.r * 0.52 * shimmer, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = "rgba(170,120,255,0.5)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(p.x, p.y - 4, p.r * 0.55, p.r * 0.26, -0.3, Math.PI * 1.1, Math.PI * 1.7); ctx.stroke();
  ctx.fillStyle = "#c9a2ff";
  ctx.font = "11px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("OIL", p.x, p.y + 4);
  ctx.restore();
}

function drawPlot(plot, t) {
  const { x, y } = plot;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath(); ctx.ellipse(x, y + 34, 44, 10, 0, 0, 7); ctx.fill();
  if (!plot.building) {
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 2;
    rr(ctx, x - 42, y - 42, 84, 84, 12); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
    const names = { collector: "COLLECTOR", treadmill: "TREADMILL", greenhouse: "GREENHOUSE" };
    ctx.fillText(names[plot.kind], x, y + 4);
  } else if (plot.kind === "collector") {
    const b = plot.building;
    // base
    ctx.fillStyle = "#2c3448"; rr(ctx, x - 34, y + 8, 68, 22, 6); ctx.fill();
    // tank with oil fill
    ctx.fillStyle = "#1a2030"; rr(ctx, x - 30, y - 34, 60, 40, 8); ctx.fill();
    const fh = 34 * (b.oil / 20);
    ctx.fillStyle = "#7a3fd1"; rr(ctx, x - 27, y + 3 - fh, 54, fh, 5); ctx.fill();
    ctx.fillStyle = "#c9a2ff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(`${b.oil}/20`, x, y - 40);
    // rotating arm
    ctx.strokeStyle = "#9aa3b8"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x, y + 8);
    const a = t * 1.6;
    ctx.lineTo(x + Math.cos(a) * 26, y + 8 + Math.sin(a) * 10); ctx.stroke();
    ctx.fillStyle = "#ffb03d";
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * 26, y + 8 + Math.sin(a) * 10, 5, 0, 7); ctx.fill();
  } else if (plot.kind === "treadmill") {
    ctx.fillStyle = "#2c3448"; rr(ctx, x - 38, y - 6, 76, 40, 8); ctx.fill();
    ctx.fillStyle = "#12161f"; rr(ctx, x - 32, y, 64, 22, 5); ctx.fill();
    ctx.strokeStyle = "#ffb03d"; ctx.lineWidth = 3;
    const off = (t * 40) % 16;
    for (let i = -1; i < 5; i++) {
      ctx.beginPath(); ctx.moveTo(x - 32 + i * 16 + off, y + 2); ctx.lineTo(x - 32 + i * 16 + off, y + 20); ctx.stroke();
    }
    ctx.fillStyle = "#ffb03d"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("+50% / RUNNER", x, y - 12);
    // helpers physically running on the belt
    const onBelt = helpers.filter(hh => hh.runnerPlot === plot && (hh.st === "running" || hh.st === "torun"));
    onBelt.forEach((hh, i) => {
      const rx = x - 14 + i * 28;
      const bob = Math.abs(Math.sin(t * 10 + i * 2)) * 5;
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(rx, y + 16, 8, 3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#e8933c";
      ctx.beginPath(); ctx.arc(rx, y - 24 - bob, 7, 0, 7); ctx.fill();
      ctx.fillRect(rx - 4, y - 18 - bob, 8, 13);
      ctx.fillStyle = "#182742";
      ctx.beginPath(); ctx.arc(rx + 2, y - 26 - bob, 3.4, 0, 7); ctx.fill();
    });
    // runner
    const rx = x + Math.sin(t * 6) * 14;
    ctx.fillStyle = "#e8933c";
    ctx.beginPath(); ctx.arc(rx, y - 22 + Math.abs(Math.sin(t * 6)) * -4, 7, 0, 7); ctx.fill();
  } else if (plot.kind === "greenhouse") {
    const g = ctx.createLinearGradient(0, y - 40, 0, y + 20);
    g.addColorStop(0, "rgba(180,240,200,0.75)"); g.addColorStop(1, "rgba(120,200,150,0.55)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y + 14, 34, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#dfe9f5"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = "#2f7d3a";
    for (let i = -2; i <= 2; i++) {
      const px = x + i * 12;
      ctx.fillRect(px - 2, y - 2, 4, 14);
      ctx.beginPath(); ctx.arc(px, y - 6, 5, 0, 7); ctx.fill();
    }
    ctx.fillStyle = "#ff6b6b";
    ctx.beginPath(); ctx.arc(x - 12, y - 8, 3.4, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 10, y - 4, 3.4, 0, 7); ctx.fill();
    ctx.fillStyle = "#7ee787"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("FOOD", x, y + 32);
  }
  ctx.restore();
}

function drawRefinery(t) {
  const { x, y } = REFINERY;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath(); ctx.ellipse(x, y + 30, 52, 12, 0, 0, 7); ctx.fill();
  const g = ctx.createLinearGradient(0, y - 50, 0, y + 30);
  g.addColorStop(0, "#3d4a68"); g.addColorStop(1, "#232b40");
  ctx.fillStyle = g; rr(ctx, x - 44, y - 46, 88, 76, 10); ctx.fill();
  ctx.strokeStyle = "#7dd7fc"; ctx.lineWidth = 2; rr(ctx, x - 44, y - 46, 88, 76, 10); ctx.stroke();
  // chimney + smoke
  ctx.fillStyle = "#161c2b"; rr(ctx, x + 18, y - 78, 16, 36, 4); ctx.fill();
  if (REFINERY.oilBuf > 0 && Math.random() < 0.3)
    parts.push({ x: x + 26, y: y - 80, vx: (Math.random() - 0.5) * 20, vy: -50 - Math.random() * 30,
      life: 0.9, max: 0.9, size: 5, col: "150,160,180" });
  // block icon
  ctx.fillStyle = "#ffb03d"; rr(ctx, x - 16, y - 24, 32, 32, 6); ctx.fill();
  ctx.fillStyle = "#c77e1e"; rr(ctx, x - 16, y - 24, 32, 10, 6); ctx.fill();
  // progress bar + buffer
  ctx.fillStyle = "#12161f"; rr(ctx, x - 40, y - 66, 80, 10, 5); ctx.fill();
  ctx.fillStyle = "#7dd7fc"; rr(ctx, x - 40, y - 66, 80 * REFINERY.prog, 10, 5); ctx.fill();
  ctx.fillStyle = "#c9a2ff"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
  ctx.fillText(`oil ${REFINERY.oilBuf}`, x, y + 48);
  ctx.fillStyle = "#7dd7fc"; ctx.font = "bold 12px sans-serif";
  ctx.fillText("REFINERY", x, y - 84);
  ctx.restore();
}

function drawRocket(t) {
  const { x, y } = ROCKET;
  ctx.save();
  const launching = state === "launch";
  if (launching) ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath(); ctx.ellipse(x, y + 52, 34, 9, 0, 0, 7); ctx.fill();
  // fins
  ctx.fillStyle = "#ff5d5d";
  ctx.beginPath(); ctx.moveTo(x - 18, y + 20); ctx.lineTo(x - 34, y + 52); ctx.lineTo(x - 18, y + 52); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + 18, y + 20); ctx.lineTo(x + 34, y + 52); ctx.lineTo(x + 18, y + 52); ctx.closePath(); ctx.fill();
  // body
  const g = ctx.createLinearGradient(x - 20, 0, x + 20, 0);
  g.addColorStop(0, "#c9cfdd"); g.addColorStop(0.5, "#ffffff"); g.addColorStop(1, "#aab1c5");
  ctx.fillStyle = g; rr(ctx, x - 20, y - 40, 40, 92, 14); ctx.fill();
  // nose
  ctx.fillStyle = "#ff5d5d";
  ctx.beginPath(); ctx.moveTo(x - 20, y - 40); ctx.quadraticCurveTo(x, y - 84, x + 20, y - 40); ctx.closePath(); ctx.fill();
  // window
  ctx.fillStyle = "#182742"; ctx.beginPath(); ctx.arc(x, y - 12, 10, 0, 7); ctx.fill();
  ctx.fillStyle = "rgba(125,215,252,0.8)"; ctx.beginPath(); ctx.arc(x - 3, y - 15, 4, 0, 7); ctx.fill();
  // flame
  if (launching) {
    const fl = 40 + Math.random() * 30;
    const fg = ctx.createLinearGradient(0, y + 52, 0, y + 52 + fl);
    fg.addColorStop(0, "rgba(255,240,200,0.95)"); fg.addColorStop(0.4, "rgba(255,170,80,0.8)"); fg.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.moveTo(x - 14, y + 52); ctx.lineTo(x + 14, y + 52); ctx.lineTo(x, y + 52 + fl); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = "#ffb03d"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
  const c = PLANETS[planetIdx].rocketCost;
  ctx.fillText(c > 0 ? `ROCKET · ${c}▦` : "HOME", x, y + 72);
  ctx.restore();
}

function render(t) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (bgPlanet !== planetIdx) makeBG();
  ctx.drawImage(bgCanvas, 0, 0, W, H);

  for (const p of pools) drawPool(p, t);
  for (const p of PLOTS) drawPlot(p, t);
  drawRefinery(t);
  drawRocket(t);

  // helpers (runners on treadmills are drawn by the treadmill itself)
  for (const h of helpers) {
    if (h.st === "running" || h.st === "torun") continue;
    drawAstronaut(h.x, h.y, 0, h.st === "tired" ? "#9aa3b8" : "#e8933c", t + h.x, h.st !== "tired", h.carry, 0.8);
    // energy bar
    ctx.fillStyle = "#12161f"; rr(ctx, h.x - 14, h.y - 44, 28, 5, 2.5); ctx.fill();
    ctx.fillStyle = h.energy > 25 ? "#7ee787" : "#ff5d5d";
    rr(ctx, h.x - 14, h.y - 44, 28 * (h.energy / 100), 5, 2.5); ctx.fill();
  }
  // player
  if (state !== "victory") drawAstronaut(player.x, player.y, player.dir, "#fff", t, player.moving, player.carry, 1);

  // particles
  for (const p of parts) {
    const a = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = `rgba(${p.col},${a.toFixed(3)})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a + 0.5, 0, 7); ctx.fill();
  }
  // floaters
  ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center";
  for (const f of floaters) {
    ctx.fillStyle = `rgba(255,220,130,${clamp(f.life, 0, 1).toFixed(3)})`;
    ctx.fillText(f.txt, f.x, f.y);
  }

  // launch flash
  if (state === "launch") {
    const a = launchT < 0.4 ? launchT / 0.4 * 0.25 : Math.max(0, 0.25 - (launchT - 2.0) * 0.6);
    if (a > 0) { ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
  }

  // vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.85);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.32)");
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

/* ---------------- Main loop ---------------- */
resetColony(false); // paint the menu backdrop
let lastT = 0;
function frame(ts) {
  const t = ts / 1000;
  let dt = Math.min(0.05, t - (lastT || t));
  lastT = t;
  if (state === "playing" || state === "launch") update(dt, t);
  else updateParts(dt);
  render(t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* debug hook (used by automated smoke tests) */
window.__mp = {
  get state() { return state; },
  get blocks() { return blocks; },
  get planet() { return planetIdx; },
  get oilCarry() { return player.carry; },
  player, helpers, pools, keys, PLOTS, REFINERY,
  start: startGame,
  buy,
  toggleHelper,
  frame(dt) { update(dt); },
  addBlocks(n) { blocks += n; refreshBuildbar(); },
  setFood(n) { food = n; },
  getFood() { return food; },
  getBlocks() { return blocks; },
  starve() { food = 0; for (const p of PLOTS) if (p.building && p.kind === "greenhouse") p.building.t = 0; },
  setPlanet(i) { planetIdx = i; },
};
