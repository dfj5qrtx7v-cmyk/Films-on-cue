#!/usr/bin/env node
/**
 * Films on Cue — hero art generator.
 *
 * Draws original black-and-white line art in the spirit of curling,
 * layered wave patterns, reworked with cinema motifs: film strips that
 * curl like breaking waves, reels unspooling, and a projector beam.
 *
 * Output: public/art/*.svg   Run: npm run art
 * Every piece is seeded, so re-running gives identical files.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'art');
const INK = '#000000';
const PAPER = '#ffffff';

/* ---------- helpers ---------- */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f = (n) => (Math.round(n * 10) / 10).toString();
function simplify(pts, tol = 0.35) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function pathD(pts, close = false) {
  if (pts.length < 2) return '';
  pts = simplify(pts);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += `L${f(pts[i][0])} ${f(pts[i][1])}`;
  return close ? d + 'Z' : d;
}

/**
 * Centre line of one curl: an Archimedean spiral wound around (cx, cy),
 * continued outward into a sweeping tail. Returns points ordered from the
 * spiral centre to the tail end, each with heading and curvature.
 */
function curlLine({ cx, cy, r0, spacing, turns, dir, start, lean = 0, tailLen, tailBend, tailRev, step = 3 }) {
  const pts = [];
  const b = spacing / (2 * Math.PI);
  const total = turns * 2 * Math.PI;
  // unless a start angle is given, wind so the tail leaves heading downward
  if (start === undefined) start = (Math.PI / 2 - dir * Math.PI / 2 + lean) - dir * total;
  let phi = 0;
  while (phi <= total) {
    const r = r0 + b * phi;
    const a = start + dir * phi;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    // advance roughly `step` px of arc length
    phi += step / Math.max(r, 1);
  }
  // tail: integrate heading with a curvature that relaxes, then reverses gently
  let [x, y] = pts[pts.length - 1];
  const [px, py] = pts[pts.length - 2];
  let h = Math.atan2(y - py, x - px);
  const rEnd = r0 + b * total;
  const k0 = dir / rEnd;
  // tailBend: extra radians the curl keeps turning; tailRev: radians it turns back (an S-sweep)
  const lambda = rEnd * tailBend;
  for (let s = 0; s < tailLen; s += step) {
    const t = s / tailLen;
    const k = k0 * Math.exp(-s / lambda) - dir * tailRev * (Math.PI / (2 * tailLen)) * Math.sin(Math.PI * t);
    h += k * step;
    x += Math.cos(h) * step; y += Math.sin(h) * step;
    pts.push([x, y]);
  }
  const line = withFrames(pts);
  line.head = { cx, cy, r: r0 + b * total };
  return line;
}
const headDisc = (line, pad) => `<circle cx="${f(line.head.cx)}" cy="${f(line.head.cy)}" r="${f(line.head.r + pad)}" fill="${INK}"/>`;

function withFrames(pts) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
    const h = Math.atan2(c[1] - a[1], c[0] - a[0]);
    out.push({ x: pts[i][0], y: pts[i][1], h });
  }
  for (let i = 0; i < n; i++) {
    const a = out[Math.max(0, i - 2)], c = out[Math.min(n - 1, i + 2)];
    let dh = c.h - a.h;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    const ds = Math.hypot(c.x - a.x, c.y - a.y) || 1;
    out[i].k = dh / ds;
  }
  // cumulative arc length
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i) s += Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
    out[i].s = s;
  }
  return out;
}

/** Offset a centre line by d; drop the part where it would cross its own centre of curvature. */
function offset(line, d, margin) {
  const valid = line.map((p) => {
    if (p.k * d >= 0 || Math.abs(p.k) < 1e-6) return true; // outer side: always fine
    return Math.abs(d) < 1 / Math.abs(p.k) - margin;
  });
  // keep the contiguous valid run that ends at the tail
  let i = line.length - 1;
  while (i > 0 && valid[i - 1]) i--;
  const pts = [];
  for (let j = i; j < line.length; j++) {
    const p = line[j];
    pts.push([p.x - Math.sin(p.h) * d, p.y + Math.cos(p.h) * d]);
  }
  return { pts, from: i };
}

/* ---------- motifs ---------- */

/** A bundle of parallel lines curling into a spiral, like a breaking wave. */
function waveBundle(o) {
  const { lines = 4, gap, stroke } = o;
  const w = (lines - 1) * gap;
  const line = curlLine({ ...o, r0: o.r0 ?? w / 2 + gap * 1.2, spacing: w + gap * 1.9 });
  const offs = [];
  for (let i = 0; i < lines; i++) offs.push(offset(line, -w / 2 + i * gap, gap * 0.6));
  const outerA = offset(line, -w / 2 - gap * 0.55, 0).pts;
  const outerB = offset(line, w / 2 + gap * 0.55, 0).pts;
  const mask = outerA.concat(outerB.slice().reverse());
  let svg = `<path d="${pathD(mask, true)}" fill="${INK}"/>` + headDisc(line, w / 2 + gap * 0.55);
  for (const l of offs) {
    if (l.pts.length > 3) svg += `<path d="${pathD(l.pts)}" stroke="${PAPER}" stroke-width="${stroke}"/>`;
  }
  return svg;
}

/** A strip of film — edges, sprocket holes and frame lines — curling the same way. */
function filmStrip(o) {
  const { width: w, stroke } = o;
  const line = curlLine({ ...o, r0: o.r0 ?? w * 0.62, spacing: w * 1.65 });
  const m = w * 0.2; // sprocket margin
  const edgeA = offset(line, -w / 2, 2);
  const edgeB = offset(line, w / 2, 2);
  const winA = offset(line, -w / 2 + m, 2);
  const winB = offset(line, w / 2 - m, 2);
  const from = Math.max(edgeA.from, edgeB.from);
  const outerA = offset(line, -w / 2 - stroke * 2.5, 0).pts;
  const outerB = offset(line, w / 2 + stroke * 2.5, 0).pts;
  const mask = outerA.slice(from).concat(outerB.slice(from).reverse());

  let svg = `<path d="${pathD(mask, true)}" fill="${INK}"/>` + headDisc(line, w / 2 + stroke * 2.5);
  svg += `<path d="${pathD(edgeA.pts)}" stroke="${PAPER}" stroke-width="${stroke * 1.15}"/>`;
  svg += `<path d="${pathD(edgeB.pts)}" stroke="${PAPER}" stroke-width="${stroke * 1.15}"/>`;
  svg += `<path d="${pathD(winA.pts.slice(Math.max(0, from - winA.from)))}" stroke="${PAPER}" stroke-width="${stroke * 0.55}"/>`;
  svg += `<path d="${pathD(winB.pts.slice(Math.max(0, from - winB.from)))}" stroke="${PAPER}" stroke-width="${stroke * 0.55}"/>`;

  // sprockets and frame dividers along the part where the strip is fully open
  const holeEvery = w * 0.36;
  const frameEvery = w * 1.08;
  let nextHole = line[from].s + holeEvery * 0.5;
  let nextFrame = line[from].s + frameEvery * 0.6;
  let holes = '', frames = '';
  const hl = holeEvery * 0.42, hw = m * 0.42;
  for (let i = from; i < line.length; i++) {
    const p = line[i];
    if (1 / Math.max(Math.abs(p.k), 1e-6) < w * 0.9) continue;
    const nx = -Math.sin(p.h), ny = Math.cos(p.h);
    const deg = (p.h * 180) / Math.PI;
    if (p.s >= nextHole) {
      for (const side of [-1, 1]) {
        const d = side * (w / 2 - m / 2);
        const x = p.x + nx * d, y = p.y + ny * d;
        holes += `<rect x="${f(-hl / 2)}" y="${f(-hw / 2)}" width="${f(hl)}" height="${f(hw)}" rx="${f(hw * 0.25)}" transform="translate(${f(x)} ${f(y)}) rotate(${f(deg)})"/>`;
      }
      nextHole += holeEvery;
    }
    if (p.s >= nextFrame) {
      const d = w / 2 - m;
      frames += `M${f(p.x - nx * d)} ${f(p.y - ny * d)}L${f(p.x + nx * d)} ${f(p.y + ny * d)}`;
      nextFrame += frameEvery;
    }
  }
  if (holes) svg += `<g fill="${PAPER}">${holes}</g>`;
  if (frames) svg += `<path d="${frames}" stroke="${PAPER}" stroke-width="${stroke * 0.55}"/>`;
  // the lip: the centre line keeps curling where the strip has closed up
  const lip = line.slice(0, from + 1).map((p) => [p.x, p.y]);
  if (lip.length > 4) svg += `<path d="${pathD(lip)}" stroke="${PAPER}" stroke-width="${stroke * 1.15}"/>`;
  return svg;
}

/** A film reel drawn in line: rims, hub, and six cut-outs. */
function reel({ cx, cy, r, stroke }) {
  let s = `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 1.04)}" fill="${INK}"/>`;
  s += `<g fill="none" stroke="${PAPER}" stroke-width="${stroke}">`;
  s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" stroke-width="${stroke * 1.4}"/>`;
  s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.93)}"/>`;
  s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.16)}"/>`;
  s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.07)}"/>`;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const hx = cx + Math.cos(a) * r * 0.55, hy = cy + Math.sin(a) * r * 0.55;
    s += `<circle cx="${f(hx)}" cy="${f(hy)}" r="${f(r * 0.22)}"/>`;
  }
  // wound film, seen edge-on as fine rings
  for (let i = 0; i < 5; i++) s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * (0.8 + i * 0.024))}" stroke-width="${stroke * 0.4}" stroke-dasharray="${f(r * 0.5)} ${f(r * 0.08)}" transform="rotate(${i * 37} ${f(cx)} ${f(cy)})"/>`;
  return s + '</g>';
}

/** Projector beam: fine rays fanning out from a lens. */
function beam({ x, y, toX, spread, rays, stroke, seed }) {
  const r = rng(seed);
  const tips = [];
  let lines = '';
  for (let i = 0; i < rays; i++) {
    const t = i / (rays - 1);
    const ty = y + (t - 0.5) * spread;
    const len = 0.82 + r() * 0.18;
    const ex = x + (toX - x) * len, ey = y + (ty - y) * len;
    tips.push([ex, ey]);
    const dash = r() > 0.6 ? `${f(6 + r() * 30)} ${f(4 + r() * 10)}` : 'none';
    lines += `<path d="M${f(x)} ${f(y)}L${f(ex)} ${f(ey)}" stroke-dasharray="${dash}"/>`;
  }
  // the beam blacks out what's behind it, ending raggedly at the ray tips
  let s = `<path d="${pathD([[x, y], ...tips], true)}" fill="${INK}"/>`;
  s += `<g stroke="${PAPER}" stroke-width="${stroke * 0.5}" fill="none">${lines}</g>`;
  s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(stroke * 7)}" fill="${INK}" stroke="${PAPER}" stroke-width="${stroke * 1.2}"/>`;
  s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(stroke * 3.2)}" fill="${PAPER}"/>`;
  return s;
}

/* ---------- compositions ---------- */

/** A staggered field of curls; `filmEvery` makes every nth one a film strip. */
function field({ W, H, seed, cols, rows, scale, filmEvery = 3, jitter = 0.35, stroke = 2.2 }) {
  const r = rng(seed);
  const items = [];
  const cw = W / cols, ch = H / rows;
  for (let row = -1; row <= rows + 1; row++) {
    for (let col = -1; col <= cols; col++) {
      const cx = (col + (row % 2 ? 0.5 : 0) + (r() - 0.5) * jitter) * cw;
      const cy = (row + (r() - 0.5) * jitter) * ch;
      items.push({ cx, cy, z: r(), idx: items.length });
    }
  }
  items.sort((a, b) => a.cy - b.cy || a.z - b.z); // lower curls overlap the ones above
  let out = '';
  items.forEach((it, n) => {
    const s = scale * (0.8 + r() * 0.45);
    const dir = r() > 0.5 ? 1 : -1;
    const base = {
      cx: it.cx, cy: it.cy, dir, stroke,
      turns: 0.95 + r() * 0.45,
      lean: (r() - 0.5) * 1.6,
      tailLen: s * (5 + r() * 2),
      tailBend: 0.5 + r() * 0.5,
      tailRev: 1.0 + r() * 0.9,
    };
    if (filmEvery && n % filmEvery === 0) out += filmStrip({ ...base, turns: 0.8 + r() * 0.3, width: s * 0.36 });
    else out += waveBundle({ ...base, lines: 3 + Math.floor(r() * 2), gap: s * 0.085 });
  });
  return out;
}

function svgDoc(W, H, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${title}">` +
    `<title>${title}</title><rect width="${W}" height="${H}" fill="${INK}"/>` +
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>\n`;
}

function write(name, svg) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), svg);
  console.log(`${name.padEnd(22)} ${(Buffer.byteLength(svg) / 1024).toFixed(0)} KB`);
}

/* Home: film strips and waves rolling across a wide landscape */
write('hero-home.svg', svgDoc(1800, 780,
  field({ W: 1800, H: 780, seed: 7, cols: 7, rows: 3, scale: 150, filmEvery: 3 }),
  'Film strips curling like breaking waves'));

/* Reviews: a narrower band of tighter curls */
write('hero-reviews.svg', svgDoc(1800, 420,
  field({ W: 1800, H: 420, seed: 21, cols: 10, rows: 2, scale: 105, filmEvery: 4, stroke: 1.8 }),
  'A band of curling film and line waves'));

/* About: a reel unspooling into the waves */
(() => {
  const W = 1800, H = 780;
  let body = field({ W, H, seed: 44, cols: 6, rows: 3, scale: 150, filmEvery: 0 });
  body += filmStrip({ cx: 1110, cy: 300, turns: 1.6, dir: -1, lean: 0.9, tailLen: 1400, tailBend: 0.8, tailRev: 1.6, width: 62, stroke: 2.2 });
  body += reel({ cx: 1480, cy: 420, r: 250, stroke: 2.2 });
  write('hero-about.svg', svgDoc(W, H, body, 'A film reel unspooling into curling waves'));
})();

/* Contact: a projector beam throwing light into the curls */
(() => {
  const W = 1800, H = 420;
  let body = field({ W, H, seed: 90, cols: 9, rows: 2, scale: 110, filmEvery: 5, stroke: 1.8 });
  body += beam({ x: 1720, y: 210, toX: 980, spread: 760, rays: 38, stroke: 2.2, seed: 5 });
  write('hero-contact.svg', svgDoc(W, H, body, 'A projector beam fanning across curling waves'));
})();

/* Placeholder still for reviews without an image (3:2) */
write('placeholder.svg', svgDoc(1200, 800,
  field({ W: 1200, H: 800, seed: 3, cols: 4, rows: 3, scale: 150, filmEvery: 3 }),
  'Curling film strip pattern'));

/* Error pages: one large curl */
(() => {
  const W = 1200, H = 800;
  let body = waveBundle({ cx: 640, cy: 330, turns: 1.9, dir: 1, lean: -0.3, tailLen: 900, tailBend: 0.8, tailRev: 1.5, lines: 5, gap: 22, stroke: 2.6 });
  body += filmStrip({ cx: 380, cy: 540, turns: 1.4, dir: -1, lean: 0.4, tailLen: 700, tailBend: 0.6, tailRev: 1.4, width: 70, stroke: 2.6 });
  write('curl.svg', svgDoc(W, H, body, 'A single curling wave and film strip'));
})();
