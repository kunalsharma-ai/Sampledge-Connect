// Generates the prebuilt call backgrounds (public/backgrounds/*.jpg and thumbs/*.jpg).
// The scenes are drawn as SVG and rendered with the browser, so they are original artwork with no
// licensing strings attached and can be regenerated or tweaked here.
//
//   node apps/web/scripts/make-call-backgrounds.mjs
//
// Needs Playwright with Chromium (a dev tool only, not part of the app build).
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const W = 1280;
const H = 720;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'backgrounds');

// ---------- small helpers ----------

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const lin = (id, stops, x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops
    .map(([o, c, op = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${op}"/>`)
    .join('')}</linearGradient>`;
const rad = (id, stops, cx = 0.5, cy = 0.5, r = 0.6) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops
    .map(([o, c, op = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${op}"/>`)
    .join('')}</radialGradient>`;
const rect = (x, y, w, h, fill, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;

// A city skyline inside a box.
function skyline(r, x, y, w, h, { near, far, lit = 0, litColor = '#ffe9a8' }) {
  let s = '';
  for (const [layer, color, minH, maxH] of [
    [0, far, 0.25, 0.65],
    [1, near, 0.15, 0.5],
  ]) {
    let cx = x - 10;
    while (cx < x + w) {
      const bw = 30 + r() * 70;
      const bh = h * (minH + r() * (maxH - minH));
      const by = y + h - bh;
      s += rect(cx.toFixed(1), by.toFixed(1), bw.toFixed(1), bh.toFixed(1), color);
      if (layer === 1 && r() < 0.3)
        s += rect((cx + bw / 2 - 2).toFixed(1), (by - 18).toFixed(1), 4, 18, color);
      if (lit > 0) {
        for (let wy = by + 8; wy < y + h - 6; wy += 12)
          for (let wx = cx + 6; wx < cx + bw - 6; wx += 10)
            if (r() < lit)
              s += rect(
                wx.toFixed(1),
                wy.toFixed(1),
                5,
                6,
                litColor,
                `opacity="${(0.5 + r() * 0.5).toFixed(2)}"`,
              );
      }
      cx += bw + 2;
    }
  }
  return s;
}

// A tall window with mullions showing a scene.
function windowFrame(x, y, w, h, cols, frame) {
  let m = '';
  for (let i = 0; i <= cols; i++) m += rect(x + (i * w) / cols - 5, y, 10, h, frame);
  m += rect(x - 5, y - 8, w + 10, 14, frame) + rect(x - 5, y + h - 6, w + 10, 14, frame);
  m += rect(x, y + h * 0.62, w, 6, frame, 'opacity="0.8"');
  return m;
}

function plant(x, y, scale, leaf = '#3f7d4e', leaf2 = '#5a9f62', pot = '#e8e2d6') {
  let s = `<g transform="translate(${x} ${y}) scale(${scale})">`;
  const leaves = [
    [-60, -150, -15],
    [50, -170, 20],
    [-20, -210, -5],
    [80, -110, 40],
    [-90, -100, -40],
    [10, -240, 5],
    [-50, -190, -25],
    [40, -220, 15],
  ];
  for (const [i, [lx, ly, rot]] of leaves.entries())
    s += `<ellipse cx="${lx}" cy="${ly}" rx="22" ry="62" fill="${i % 2 ? leaf : leaf2}" transform="rotate(${rot} ${lx} ${ly})"/>`;
  s += `<path d="M-55 -40 L55 -40 L42 40 L-42 40 Z" fill="${pot}"/>`;
  s += `<rect x="-60" y="-48" width="120" height="12" rx="4" fill="${pot}" opacity="0.9"/>`;
  return s + '</g>';
}

function shelfWithBooks(r, x, y, w, rows, gap, board, palette) {
  let s = '';
  for (let i = 0; i < rows; i++) {
    const by = y + i * gap;
    s += rect(x, by, w, 10, board);
    let bx = x + 6;
    while (bx < x + w - 20) {
      if (r() < 0.12) {
        // an object instead of a book
        const ow = 34;
        s +=
          r() < 0.5
            ? `<circle cx="${bx + ow / 2}" cy="${by - 18}" r="16" fill="${pick(r, ['#d9cbb3', '#c8d4d9', '#e7d9c7'])}"/>`
            : rect(bx, by - 46, ow, 46, pick(r, ['#c9b9a0', '#9fb4b8', '#d8d0c4']), 'rx="3"');
        bx += ow + 10;
        continue;
      }
      const bw = 10 + r() * 14;
      const bh = gap * (0.5 + r() * 0.35);
      const lean = r() < 0.08 ? `transform="rotate(-12 ${bx} ${by})"` : '';
      s += rect(
        bx.toFixed(1),
        (by - bh).toFixed(1),
        bw.toFixed(1),
        bh.toFixed(1),
        pick(r, palette),
        lean,
      );
      bx += bw + 1.5;
    }
  }
  return s;
}

function pendant(x, y, len, color = '#1f2933', glow = '#ffe7b0') {
  return `<line x1="${x}" y1="0" x2="${x}" y2="${y + len}" stroke="#2b2b2b" stroke-width="2"/>
  <ellipse cx="${x}" cy="${y + len + 14}" rx="70" ry="22" fill="${glow}" opacity="0.18"/>
  <path d="M${x - 34} ${y + len + 22} Q${x} ${y + len - 22} ${x + 34} ${y + len + 22} Z" fill="${color}"/>`;
}

function frameArt(x, y, w, h, colors) {
  return `${rect(x - 8, y - 8, w + 16, h + 16, '#2a2a2a')}${rect(x, y, w, h, colors[0])}
  <circle cx="${x + w * 0.35}" cy="${y + h * 0.45}" r="${h * 0.28}" fill="${colors[1]}"/>
  ${rect(x + w * 0.5, y + h * 0.2, w * 0.35, h * 0.6, colors[2], 'opacity="0.85"')}`;
}

// Wraps a scene: soft focus (like a real camera behind you) and a light vignette.
function svg(defs, body, { blur = 1.6, vignette = 0.35 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
<defs>${defs}
<filter id="soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${blur}"/></filter>
${rad(
  'vig',
  [
    [0.55, '#000', 0],
    [1, '#000', vignette],
  ],
  0.5,
  0.5,
  0.75,
)}
</defs>
<g filter="url(#soft)">${body}</g>
${rect(0, 0, W, H, 'url(#vig)')}
</svg>`;
}

// ---------- scenes ----------

function windowOffice(seed, { sky, near, far, lit, litColor, wall, frame, floorC, extra = '' }) {
  const r = rng(seed);
  const wx = 120,
    wy = 70,
    ww = 1040,
    wh = 470;
  const defs =
    lin('sky', sky) +
    lin('wall', wall) +
    lin('flr', floorC) +
    `<clipPath id="win"><rect x="${wx}" y="${wy}" width="${ww}" height="${wh}"/></clipPath>`;
  let b = rect(0, 0, W, H, 'url(#wall)');
  b += `<g clip-path="url(#win)">${rect(wx, wy, ww, wh, 'url(#sky)')}${skyline(r, wx, wy + wh * 0.35, ww, wh * 0.65, { near, far, lit, litColor })}</g>`;
  b += windowFrame(wx, wy, ww, wh, 4, frame);
  b += rect(0, 560, W, 160, 'url(#flr)');
  b += rect(0, 556, W, 6, frame, 'opacity="0.6"');
  b += extra;
  return svg(defs, b);
}

const scenes = {
  'skyline-office': () =>
    windowOffice(11, {
      sky: [
        [0, '#8fc3ea'],
        [1, '#dcefff'],
      ],
      near: '#6f8aa3',
      far: '#a9bdd0',
      lit: 0,
      wall: [
        [0, '#eef1f4'],
        [1, '#dfe4ea'],
      ],
      frame: '#3a4450',
      floorC: [
        [0, '#c9b9a3'],
        [1, '#a88f72'],
      ],
      extra: plant(1180, 640, 0.9) + plant(95, 650, 0.75, '#356b44', '#4e8f58', '#d9d4ca'),
    }),
  'dusk-skyline': () =>
    windowOffice(23, {
      sky: [
        [0, '#2f3d6b'],
        [0.55, '#c56b6b'],
        [1, '#f5b27a'],
      ],
      near: '#26283a',
      far: '#4a4560',
      lit: 0.18,
      wall: [
        [0, '#34323d'],
        [1, '#27252e'],
      ],
      frame: '#16151b',
      floorC: [
        [0, '#4a3a33'],
        [1, '#2a211c'],
      ],
      extra: pendant(300, 0, 40, '#111', '#ffcf8a') + pendant(980, 0, 40, '#111', '#ffcf8a'),
    }),
  'night-city': () =>
    windowOffice(37, {
      sky: [
        [0, '#070b1c'],
        [1, '#1b2550'],
      ],
      near: '#0b0f22',
      far: '#18203f',
      lit: 0.32,
      wall: [
        [0, '#14161f'],
        [1, '#0e1016'],
      ],
      frame: '#05060a',
      floorC: [
        [0, '#1b1d26'],
        [1, '#0c0d12'],
      ],
      extra:
        `<circle cx="1050" cy="150" r="26" fill="#f1f0e6" opacity="0.9"/>` +
        plant(1185, 650, 0.85, '#1f3b2a', '#2a4e37', '#2b2d36'),
    }),
  'mountain-view': () => {
    const defs =
      lin('sky', [
        [0, '#a7cdf0'],
        [1, '#eaf4fb'],
      ]) +
      lin('wall', [
        [0, '#f1ede6'],
        [1, '#e2dcd1'],
      ]) +
      lin('flr', [
        [0, '#b99b7a'],
        [1, '#8a6c50'],
      ]) +
      `<clipPath id="win"><rect x="120" y="70" width="1040" height="470"/></clipPath>`;
    let b = rect(0, 0, W, H, 'url(#wall)');
    b += `<g clip-path="url(#win)">${rect(120, 70, 1040, 470, 'url(#sky)')}
      <path d="M120 420 L300 230 L420 330 L560 180 L720 360 L860 240 L1000 350 L1160 260 L1160 540 L120 540 Z" fill="#8aa0b8"/>
      <path d="M520 220 L560 180 L600 222 L580 215 L560 230 L540 214 Z" fill="#fff" opacity="0.9"/>
      <path d="M120 470 L280 380 L460 440 L640 360 L820 450 L1000 390 L1160 450 L1160 540 L120 540 Z" fill="#5f7f6a"/>
      <path d="M120 510 L400 470 L700 500 L1000 465 L1160 500 L1160 540 L120 540 Z" fill="#3f604b"/></g>`;
    b += windowFrame(120, 70, 1040, 470, 3, '#2f2a25');
    b += rect(0, 560, W, 160, 'url(#flr)') + plant(1180, 650, 0.85);
    return svg(defs, b);
  },
  'seaside-view': () => {
    const defs =
      lin('sky', [
        [0, '#7fc0e6'],
        [1, '#d9f0fb'],
      ]) +
      lin('sea', [
        [0, '#2f86b0'],
        [1, '#5fb2cf'],
      ]) +
      lin('wall', [
        [0, '#fbfaf7'],
        [1, '#ebe7df'],
      ]) +
      lin('flr', [
        [0, '#d9cbb5'],
        [1, '#bba88c'],
      ]) +
      `<clipPath id="win"><rect x="120" y="70" width="1040" height="470"/></clipPath>`;
    let b = rect(0, 0, W, H, 'url(#wall)');
    b += `<g clip-path="url(#win)">${rect(120, 70, 1040, 470, 'url(#sky)')}${rect(120, 330, 1040, 210, 'url(#sea)')}
      <ellipse cx="400" cy="160" rx="90" ry="22" fill="#fff" opacity="0.8"/><ellipse cx="880" cy="200" rx="120" ry="26" fill="#fff" opacity="0.7"/>
      <path d="M120 360 Q300 340 420 352 T760 346 T1160 356" stroke="#fff" stroke-width="3" fill="none" opacity="0.4"/>
      <path d="M120 470 Q400 440 700 470 T1160 460 L1160 540 L120 540 Z" fill="#efe2c6"/></g>`;
    b += windowFrame(120, 70, 1040, 470, 3, '#e8e4dc');
    b += rect(0, 560, W, 160, 'url(#flr)') + plant(100, 650, 0.8, '#4a8a5c', '#62a874', '#f3efe8');
    return svg(defs, b);
  },
  'glass-meeting-room': () => {
    const r = rng(51);
    const defs =
      lin('wall', [
        [0, '#e9edf1'],
        [1, '#d6dde4'],
      ]) +
      lin(
        'glass',
        [
          [0, '#cfe3ee', 0.55],
          [1, '#b8d0dd', 0.45],
        ],
        1,
        1,
      ) +
      lin('flr', [
        [0, '#9aa3ab'],
        [1, '#6d757d'],
      ]);
    let b = rect(0, 0, W, H, 'url(#wall)');
    // office floor seen through the glass
    for (let i = 0; i < 9; i++) {
      const x = 60 + i * 140;
      b +=
        rect(x, 330, 110, 70, '#f3f4f6') +
        rect(x + 10, 290, 90, 46, '#2d3540') +
        rect(x + 45, 336, 20, 30, '#5a6470');
    }
    b += shelfWithBooks(r, 40, 250, 220, 1, 60, '#8a7a66', [
      '#40576e',
      '#c46b4f',
      '#e3c27a',
      '#6d8b74',
    ]);
    b += rect(0, 120, W, 440, 'url(#glass)');
    for (let i = 0; i <= 5; i++) b += rect(i * 256 - 3, 120, 6, 440, '#7d8893');
    b += rect(0, 300, W, 18, '#ffffff', 'opacity="0.35"');
    b += rect(0, 0, W, 120, '#f5f7f9') + rect(0, 560, W, 160, 'url(#flr)');
    for (let i = 0; i < 6; i++)
      b += rect(80 + i * 210, 30, 120, 14, '#ffffff', 'rx="7" opacity="0.9"');
    b += plant(1190, 650, 0.85);
    return svg(defs, b);
  },
  boardroom: () => {
    const defs =
      lin('wall', [
        [0, '#3b3f46'],
        [1, '#2c2f35'],
      ]) +
      lin(
        'panel',
        [
          [0, '#6b4f3a'],
          [1, '#4f3a2a'],
        ],
        1,
        0,
      ) +
      lin('flr', [
        [0, '#2a2522'],
        [1, '#191512'],
      ]) +
      lin(
        'screen',
        [
          [0, '#1d3557'],
          [1, '#274b7a'],
        ],
        1,
        1,
      );
    let b = rect(0, 0, W, H, 'url(#wall)');
    for (let i = 0; i < 10; i++) b += rect(i * 128, 80, 124, 500, 'url(#panel)');
    b += rect(380, 150, 520, 290, '#0c0d10') + rect(392, 162, 496, 266, 'url(#screen)');
    b += `<path d="M430 380 L520 300 L600 340 L700 250 L840 300" stroke="#7fb7ff" stroke-width="6" fill="none" opacity="0.8"/>`;
    b += rect(0, 560, W, 160, 'url(#flr)');
    b += `<ellipse cx="640" cy="640" rx="560" ry="70" fill="#5a3e2b"/><ellipse cx="640" cy="630" rx="540" ry="60" fill="#6e4c34"/>`;
    for (const x of [140, 1140]) b += pendant(x, 0, 30, '#151515', '#ffd79a');
    return svg(defs, b);
  },
  'executive-wood': () => {
    const r = rng(73);
    const defs =
      lin(
        'wall',
        [
          [0, '#5a4231'],
          [1, '#3f2e22'],
        ],
        1,
        0,
      ) +
      lin('flr', [
        [0, '#2f241c'],
        [1, '#1b140f'],
      ]);
    let b = rect(0, 0, W, H, 'url(#wall)');
    for (let i = 0; i < 16; i++) b += rect(i * 80, 0, 3, 720, '#2f2219', 'opacity="0.5"');
    b +=
      rect(0, 0, 360, 600, '#3a2a1f') +
      shelfWithBooks(r, 20, 140, 320, 4, 120, '#6d5039', [
        '#7a2e2e',
        '#2f4a3a',
        '#2c3e57',
        '#b08a4a',
        '#5a3d2b',
        '#d8c7a6',
      ]);
    b +=
      rect(920, 0, 360, 600, '#3a2a1f') +
      shelfWithBooks(r, 940, 140, 320, 4, 120, '#6d5039', [
        '#7a2e2e',
        '#2f4a3a',
        '#2c3e57',
        '#b08a4a',
        '#5a3d2b',
        '#d8c7a6',
      ]);
    b += frameArt(520, 120, 240, 160, ['#d8cdb8', '#8a5a3a', '#2f4a3a']);
    b += rect(0, 590, W, 130, 'url(#flr)');
    b += `<ellipse cx="640" cy="160" rx="260" ry="120" fill="#ffd59a" opacity="0.08"/>`;
    return svg(defs, b);
  },
  library: () => {
    const r = rng(89);
    const defs =
      lin('wall', [
        [0, '#2b2420'],
        [1, '#1f1916'],
      ]) +
      lin('flr', [
        [0, '#3a2c22'],
        [1, '#22190f'],
      ]);
    let b = rect(0, 0, W, H, 'url(#wall)');
    b += shelfWithBooks(r, 0, 120, W, 5, 108, '#5b4330', [
      '#8c2f39',
      '#1f4e5f',
      '#c9a227',
      '#3b5d3a',
      '#6d4c41',
      '#d7ccc8',
      '#283b6b',
      '#a0522d',
    ]);
    for (let i = 0; i <= 6; i++) b += rect(i * 213 - 6, 0, 12, 640, '#4a3626');
    b += rect(0, 640, W, 80, 'url(#flr)');
    b += `<ellipse cx="640" cy="300" rx="520" ry="320" fill="#ffcf8a" opacity="0.07"/>`;
    return svg(defs, b, { blur: 2 });
  },
  reception: () => {
    const defs =
      lin('wall', [
        [0, '#f4f2ef'],
        [1, '#e4e0da'],
      ]) +
      lin(
        'accent',
        [
          [0, '#25343f'],
          [1, '#1b262f'],
        ],
        1,
        0,
      ) +
      lin('flr', [
        [0, '#d7d2ca'],
        [1, '#b5aea3'],
      ]);
    let b = rect(0, 0, W, H, 'url(#wall)');
    b += rect(360, 60, 560, 380, 'url(#accent)');
    for (let i = 0; i < 14; i++) b += rect(360 + i * 40, 60, 2, 380, '#2f404c');
    b += rect(470, 220, 340, 10, '#c9a45c', 'rx="5" opacity="0.9"');
    b += rect(300, 440, 680, 120, '#efe9e0') + rect(300, 440, 680, 14, '#c9a45c');
    b += rect(0, 560, W, 160, 'url(#flr)');
    b +=
      plant(140, 650, 1, '#3e7a4f', '#58985f', '#2a2a2a') +
      plant(1140, 650, 1, '#3e7a4f', '#58985f', '#2a2a2a');
    for (const x of [200, 1080]) b += pendant(x, 0, 60, '#c9a45c', '#fff1c9');
    return svg(defs, b);
  },
  'brick-coworking': () => {
    const r = rng(97);
    const defs = lin('flr', [
      [0, '#6b5747'],
      [1, '#463629'],
    ]);
    let b = rect(0, 0, W, H, '#9b5a44');
    for (let row = 0; row < 32; row++)
      for (let col = -1; col < 22; col++) {
        const x = col * 62 + (row % 2 ? 31 : 0);
        const shade = ['#a8624a', '#94543f', '#b06b51', '#8c4e3b', '#9f5c45'][Math.floor(r() * 5)];
        b += rect(x + 2, row * 22 + 2, 58, 18, shade);
      }
    b +=
      rect(80, 120, 300, 12, '#2b2b2b') +
      shelfWithBooks(r, 80, 120, 300, 1, 80, '#2b2b2b', [
        '#e7d3a8',
        '#2e4a62',
        '#c75b39',
        '#4d6b50',
      ]);
    b += rect(880, 110, 300, 190, '#1d1d1d') + rect(890, 120, 280, 170, '#f2efe8');
    b += `<text x="1030" y="225" text-anchor="middle" font-family="Georgia, serif" font-size="40" fill="#2b2b2b">ideas</text>`;
    for (const x of [320, 640, 960]) b += pendant(x, 0, 50, '#111', '#ffd27f');
    b +=
      rect(0, 580, W, 140, 'url(#flr)') +
      plant(1180, 660, 0.85) +
      plant(90, 660, 0.7, '#4c7c3f', '#6d9e55', '#3a3a3a');
    return svg(defs, b, { blur: 1.8 });
  },
  'scandi-room': () => {
    const defs =
      lin('wall', [
        [0, '#fbfaf7'],
        [1, '#efebe4'],
      ]) +
      lin('flr', [
        [0, '#e4d6c0'],
        [1, '#cdb99a'],
      ]);
    let b = rect(0, 0, W, H, 'url(#wall)');
    b +=
      rect(80, 150, 260, 10, '#d4bfa0') +
      `<circle cx="140" cy="128" r="22" fill="#d9e3dc"/>` +
      rect(200, 100, 40, 50, '#e8d9c4', 'rx="4"');
    b += frameArt(930, 140, 220, 150, ['#f1ece3', '#e0b9a0', '#9db3a8']);
    b += rect(0, 580, W, 140, 'url(#flr)');
    for (let i = 0; i < 18; i++) b += rect(i * 72, 580, 2, 140, '#c7b391', 'opacity="0.6"');
    b +=
      plant(1150, 660, 1.05, '#5a8f68', '#7cae84', '#f4f1ea') +
      plant(150, 660, 0.8, '#5a8f68', '#7cae84', '#d8cbb6');
    b += `<ellipse cx="300" cy="260" rx="360" ry="260" fill="#fff6dc" opacity="0.18"/>`;
    return svg(defs, b);
  },
  lounge: () => {
    const defs =
      lin('wall', [
        [0, '#2f4a4a'],
        [1, '#253b3b'],
      ]) +
      lin('flr', [
        [0, '#c4b097'],
        [1, '#9c8a72'],
      ]);
    let b = rect(0, 0, W, H, 'url(#wall)');
    b +=
      frameArt(170, 130, 200, 260, ['#e9dfcc', '#d07b52', '#33525a']) +
      frameArt(910, 160, 220, 160, ['#e9dfcc', '#8fb0a9', '#d9a441']);
    b += `<path d="M80 470 Q80 430 120 430 L1160 430 Q1200 430 1200 470 L1200 600 L80 600 Z" fill="#c9b48f"/>`;
    b += rect(100, 470, 1080, 70, '#d8c4a0', 'rx="18"');
    b += rect(0, 600, W, 120, 'url(#flr)');
    for (const x of [640]) b += pendant(x, 0, 40, '#c9a45c', '#ffe5a8');
    return svg(defs, b);
  },
  'green-wall': () => {
    const r = rng(131);
    const defs = lin('flr', [
      [0, '#b6aa98'],
      [1, '#8f8474'],
    ]);
    let b = rect(0, 0, W, H, '#244a2f');
    for (let i = 0; i < 900; i++) {
      const x = r() * W,
        y = r() * 600,
        rr = 10 + r() * 22;
      b += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${rr.toFixed(0)}" ry="${(rr * 0.55).toFixed(0)}" fill="${pick(r, ['#2f6b3d', '#3d8a4c', '#4f9e58', '#2a5c35', '#62b06a', '#1f4a2a'])}" transform="rotate(${(r() * 180).toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})"/>`;
    }
    b += rect(0, 600, W, 120, 'url(#flr)') + rect(0, 594, W, 8, '#3b3b3b');
    return svg(defs, b, { blur: 2.2 });
  },
  'home-office': () => {
    const r = rng(149);
    const defs =
      lin('wall', [
        [0, '#e9dccb'],
        [1, '#d8c7b0'],
      ]) +
      lin('flr', [
        [0, '#a07a55'],
        [1, '#7a5a3d'],
      ]) +
      lin('sky', [
        [0, '#bfe0f5'],
        [1, '#eef7fc'],
      ]);
    let b = rect(0, 0, W, H, 'url(#wall)');
    b += rect(860, 90, 320, 380, '#f7f3ec') + rect(880, 110, 280, 340, 'url(#sky)');
    b += `<path d="M880 380 Q960 330 1040 360 T1160 350 L1160 450 L880 450 Z" fill="#9cc49a"/>`;
    b += rect(1016, 110, 8, 340, '#f7f3ec') + rect(880, 276, 280, 8, '#f7f3ec');
    b +=
      rect(80, 180, 300, 10, '#8b6a4a') +
      shelfWithBooks(r, 80, 180, 300, 1, 80, '#8b6a4a', [
        '#c75b39',
        '#3e5c76',
        '#e3b448',
        '#6b8f71',
        '#efe6d8',
      ]);
    b +=
      rect(80, 300, 300, 10, '#8b6a4a') +
      shelfWithBooks(r, 80, 300, 300, 1, 80, '#8b6a4a', [
        '#c75b39',
        '#3e5c76',
        '#e3b448',
        '#6b8f71',
        '#efe6d8',
      ]);
    b += rect(0, 590, W, 130, 'url(#flr)') + plant(1210, 670, 0.9);
    b += `<path d="M300 590 L330 470 L360 470 L345 590 Z" fill="#3b3b3b"/><ellipse cx="345" cy="462" rx="38" ry="14" fill="#f2d48a"/>`;
    return svg(defs, b);
  },
  'navy-geometric': () => {
    const r = rng(163);
    const defs = lin(
      'bg',
      [
        [0, '#0f1c3a'],
        [1, '#1b2f5e'],
      ],
      1,
      1,
    );
    let b = rect(0, 0, W, H, 'url(#bg)');
    for (let i = 0; i < 26; i++) {
      const x = r() * W,
        y = r() * H,
        s = 80 + r() * 260;
      b += `<polygon points="${x},${y} ${x + s},${y + s * 0.3} ${x + s * 0.4},${y + s}" fill="${pick(r, ['#24407a', '#2c4f94', '#16264d', '#3a63b0'])}" opacity="${(0.25 + r() * 0.4).toFixed(2)}"/>`;
    }
    return svg(defs, b, { blur: 0.8, vignette: 0.45 });
  },
  'soft-bokeh': () => {
    const r = rng(181);
    const defs = lin(
      'bg',
      [
        [0, '#1d1a2b'],
        [1, '#2d2338'],
      ],
      1,
      1,
    );
    let b = rect(0, 0, W, H, 'url(#bg)');
    for (let i = 0; i < 70; i++)
      b += `<circle cx="${(r() * W).toFixed(0)}" cy="${(r() * H).toFixed(0)}" r="${(14 + r() * 60).toFixed(0)}" fill="${pick(r, ['#ffcf8a', '#ffb3a1', '#a9c7ff', '#ffe9b8'])}" opacity="${(0.12 + r() * 0.3).toFixed(2)}"/>`;
    return svg(defs, b, { blur: 6, vignette: 0.4 });
  },
  'slate-gradient': () =>
    svg(
      rad(
        'bg',
        [
          [0, '#5b6b7c'],
          [1, '#26303b'],
        ],
        0.5,
        0.4,
        0.8,
      ),
      rect(0, 0, W, H, 'url(#bg)'),
      { blur: 0, vignette: 0.3 },
    ),
  'warm-gradient': () =>
    svg(
      rad(
        'bg',
        [
          [0, '#f3e3cf'],
          [1, '#cfae8a'],
        ],
        0.45,
        0.35,
        0.85,
      ),
      rect(0, 0, W, H, 'url(#bg)'),
      { blur: 0, vignette: 0.2 },
    ),
  'teal-waves': () => {
    const defs = lin(
      'bg',
      [
        [0, '#0f3d46'],
        [1, '#13606b'],
      ],
      1,
      1,
    );
    let b = rect(0, 0, W, H, 'url(#bg)');
    for (let i = 0; i < 9; i++)
      b += `<path d="M0 ${200 + i * 60} C 300 ${120 + i * 60}, 700 ${320 + i * 60}, 1280 ${170 + i * 60}" stroke="#5fc4c0" stroke-width="${2 + i}" fill="none" opacity="${(0.1 + i * 0.04).toFixed(2)}"/>`;
    return svg(defs, b, { blur: 1.2, vignette: 0.4 });
  },
};

// ---------- render ----------

const { chromium } = require('playwright');
mkdirSync(join(OUT, 'thumbs'), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const thumb = await browser.newPage({ viewport: { width: 320, height: 180 } });
const only = process.argv[2];
for (const [id, make] of Object.entries(scenes)) {
  if (only && only !== id) continue;
  const html = `<html><body style="margin:0;overflow:hidden">${make()}</body></html>`;
  await page.setContent(html);
  await page.screenshot({ path: join(OUT, `${id}.jpg`), type: 'jpeg', quality: 84 });
  await thumb.setContent(
    html.replace('<svg ', '<svg style="width:320px;height:180px;display:block" '),
  );
  await thumb.screenshot({ path: join(OUT, 'thumbs', `${id}.jpg`), type: 'jpeg', quality: 80 });
  console.log('made', id);
}
await browser.close();
