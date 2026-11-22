/**
 * Motifs for greeting cards: small original illustrations drawn in a 200×200 box centred on
 * (0, 0). Each takes the occasion palette so the same drawing can serve several occasions.
 * Kept free of ids (no <defs>), so many cards can sit on one page without clashing.
 */
export interface GreetingPalette {
  /** Main colour. */
  a: string;
  /** Second colour. */
  b: string;
  /** Highlight (gold, flame, sparkle). */
  c: string;
  /** Deep shade for radiant and festive panels. */
  d: string;
}

type Motif = (p: GreetingPalette) => string;

const sparkle = (x: number, y: number, r: number, fill: string, o = 1) =>
  `<path d="M${x} ${y - r}Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y}Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r}Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y}Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}Z" fill="${fill}" opacity="${o}"/>`;

/** A crescent opening to the right, tilted by `tilt` degrees. */
const moon = (x: number, y: number, r: number, fill: string, tilt = -20) =>
  `<path d="M0 ${-r}A${r} ${r} 0 1 0 0 ${r}A${r * 0.62} ${r} 0 1 1 0 ${-r}Z" fill="${fill}" transform="translate(${x} ${y}) rotate(${tilt})"/>`;

const flame = (x: number, y: number, h: number) =>
  `<path d="M${x} ${y - h}C${x + h * 0.5} ${y - h * 0.45} ${x + h * 0.42} ${y} ${x} ${y}C${x - h * 0.42} ${y} ${x - h * 0.5} ${y - h * 0.45} ${x} ${y - h}Z" fill="#FFB02E"/>` +
  `<path d="M${x} ${y - h * 0.66}C${x + h * 0.26} ${y - h * 0.32} ${x + h * 0.22} ${y} ${x} ${y}C${x - h * 0.22} ${y} ${x - h * 0.26} ${y - h * 0.32} ${x} ${y - h * 0.66}Z" fill="#FFE68A"/>`;

const petal = (angle: number, len: number, w: number, fill: string, cx = 0, cy = 0) =>
  `<ellipse cx="${cx}" cy="${cy - len / 2}" rx="${w}" ry="${len / 2}" fill="${fill}" transform="rotate(${angle} ${cx} ${cy})"/>`;

const flower = (x: number, y: number, r: number, fill: string, centre: string, n = 6) =>
  Array.from({ length: n }, (_, i) => petal((360 / n) * i, r, r * 0.38, fill, x, y)).join('') +
  `<circle cx="${x}" cy="${y}" r="${r * 0.32}" fill="${centre}"/>`;

const heart = (x: number, y: number, s: number, fill: string, extra = '') =>
  `<path d="M${x} ${y + s * 0.9}C${x - s * 1.4} ${y - s * 0.1} ${x - s * 0.9} ${y - s * 1.2} ${x} ${y - s * 0.45}C${x + s * 0.9} ${y - s * 1.2} ${x + s * 1.4} ${y - s * 0.1} ${x} ${y + s * 0.9}Z" fill="${fill}" ${extra}/>`;

const leaf = (x: number, y: number, len: number, angle: number, fill: string) =>
  `<path d="M0 0C${len * 0.3} ${-len * 0.28} ${len * 0.75} ${-len * 0.26} ${len} 0C${len * 0.75} ${len * 0.26} ${len * 0.3} ${len * 0.28} 0 0Z" fill="${fill}" transform="translate(${x} ${y}) rotate(${angle})"/>`;

const marigold = (x: number, y: number, r: number) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="#F59E0B"/>` +
  `<circle cx="${x}" cy="${y}" r="${r * 0.72}" fill="#FBBF24"/>` +
  `<circle cx="${x}" cy="${y}" r="${r * 0.4}" fill="#F97316"/>`;

export const GREETING_MOTIFS: Record<string, Motif> = {
  diya: (p) =>
    `<ellipse cx="0" cy="70" rx="86" ry="10" fill="#000" opacity="0.18"/>` +
    `<path d="M-78 18Q-70 72 0 72Q70 72 78 18Z" fill="${p.b}"/>` +
    `<path d="M-78 18Q0 40 78 18Q60 30 0 32Q-60 30 -78 18Z" fill="${p.c}" opacity="0.9"/>` +
    `<path d="M-62 40Q0 58 62 40" stroke="${p.c}" stroke-width="4" fill="none" stroke-dasharray="2 9" stroke-linecap="round"/>` +
    `<path d="M70 20Q98 6 102 -6Q90 8 64 14Z" fill="${p.b}"/>` +
    `<circle cx="0" cy="-12" r="44" fill="#FFD36B" opacity="0.25"/>` +
    flame(0, 18, 66) +
    sparkle(-70, -60, 10, p.c) +
    sparkle(76, -48, 7, p.c, 0.8),
  colours: (p) =>
    [
      ['#FF3D7F', -52, -18, 54],
      ['#FFC400', 40, -40, 46],
      ['#00B3A4', 46, 34, 50],
      ['#6C4DFF', -34, 46, 42],
      ['#FF7A00', 0, 0, 30],
    ]
      .map(
        ([c, x, y, r]) =>
          `<g transform="translate(${x} ${y})"><circle r="${r}" fill="${c}" opacity="0.9"/>` +
          [0, 72, 144, 216, 288]
            .map(
              (a, i) =>
                `<circle cx="${Math.cos((a * Math.PI) / 180) * (Number(r) + 10 + i * 2)}" cy="${Math.sin((a * Math.PI) / 180) * (Number(r) + 10 + i * 2)}" r="${5 + (i % 3) * 3}" fill="${c}"/>`,
            )
            .join('') +
          `</g>`,
      )
      .join('') + sparkle(-84, -70, 9, p.c),
  rakhi: (p) =>
    `<path d="M-110 6C-60 -8 -30 4 0 0C30 -4 60 8 110 -6" stroke="${p.b}" stroke-width="6" fill="none" stroke-linecap="round"/>` +
    `<path d="M-110 14C-60 0 -30 12 0 8C30 4 60 16 110 2" stroke="${p.c}" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    flower(0, 4, 58, p.a, p.c, 10) +
    flower(0, 4, 34, p.b, p.c, 8) +
    `<circle cx="0" cy="4" r="16" fill="${p.c}"/><circle cx="0" cy="4" r="8" fill="#fff" opacity="0.7"/>` +
    [-80, 80].map((x) => `<circle cx="${x}" cy="${x < 0 ? 8 : -2}" r="7" fill="${p.c}"/>`).join(''),
  flute: (p) =>
    `<g transform="rotate(-24)"><rect x="-104" y="-9" width="208" height="18" rx="9" fill="#C68B3E"/>` +
    `<rect x="-104" y="-9" width="208" height="6" rx="3" fill="#E6B66E"/>` +
    [-60, -36, -12, 12, 36].map((x) => `<circle cx="${x}" cy="0" r="4" fill="#5B3A12"/>`).join('') +
    `<rect x="-78" y="-10" width="8" height="20" fill="${p.c}"/><rect x="64" y="-10" width="8" height="20" fill="${p.c}"/></g>` +
    // Peacock feather.
    `<g transform="translate(46 -30) rotate(28)"><path d="M0 70Q-4 0 0 -70" stroke="#2F7D4F" stroke-width="3" fill="none"/>` +
    Array.from({ length: 12 }, (_, i) =>
      leaf(
        0,
        60 - i * 10,
        36 - Math.abs(i - 6) * 2,
        -150 + (i % 2) * 120,
        i % 2 ? '#2BA36B' : '#45C486',
      ),
    ).join('') +
    `<ellipse cx="0" cy="-54" rx="22" ry="28" fill="#14A38B"/><ellipse cx="0" cy="-52" rx="14" ry="18" fill="#2A57C9"/><ellipse cx="0" cy="-50" rx="7" ry="9" fill="#0B1F5C"/></g>`,
  modak: (p) =>
    `<ellipse cx="0" cy="62" rx="100" ry="18" fill="${p.c}"/><ellipse cx="0" cy="56" rx="92" ry="13" fill="#FCE7A8"/>` +
    [-44, 0, 44]
      .map(
        (x, i) =>
          `<g transform="translate(${x} ${i === 1 ? 14 : 30})"><path d="M0 -52C12 -38 36 -12 36 8C36 22 22 30 0 30C-22 30 -36 22 -36 8C-36 -12 -12 -38 0 -52Z" fill="#FFF4DE"/>` +
          [-24, -12, 0, 12, 24]
            .map(
              (dx) =>
                `<path d="M${dx * 0.3} -48Q${dx} -10 ${dx} 28" stroke="#E7CFA4" stroke-width="2" fill="none"/>`,
            )
            .join('') +
          `</g>`,
      )
      .join('') +
    marigold(-84, -40, 16) +
    marigold(84, -50, 14) +
    marigold(-70, -76, 10) +
    marigold(70, -86, 9),
  dandiya: (p) =>
    [-30, 30]
      .map(
        (a, i) =>
          `<g transform="rotate(${a})"><rect x="-7" y="-100" width="14" height="200" rx="7" fill="${i ? p.a : p.b}"/>` +
          [-70, -35, 0, 35, 70]
            .map(
              (y, j) =>
                `<rect x="-7" y="${y - 4}" width="14" height="8" fill="${j % 2 ? p.c : '#fff'}"/>`,
            )
            .join('') +
          `<circle cy="-100" r="10" fill="${p.c}"/><circle cy="100" r="10" fill="${p.c}"/></g>`,
      )
      .join('') +
    sparkle(-60, -50, 12, p.c) +
    sparkle(64, -46, 9, '#fff') +
    sparkle(0, 70, 8, p.c),
  lotus: (p) =>
    `<ellipse cx="0" cy="66" rx="96" ry="12" fill="${p.b}" opacity="0.5"/>` +
    [-70, -45, -22, 22, 45, 70]
      .map(
        (a) =>
          `<path d="M0 50C-22 10 -18 -30 0 -60C18 -30 22 10 0 50Z" fill="${p.b}" transform="rotate(${a} 0 50)"/>`,
      )
      .join('') +
    [-34, 0, 34]
      .map(
        (a) =>
          `<path d="M0 50C-24 10 -20 -40 0 -74C20 -40 24 10 0 50Z" fill="${p.a}" transform="rotate(${a} 0 50)"/>`,
      )
      .join('') +
    `<path d="M0 50C-10 10 -8 -40 0 -74C8 -40 10 10 0 50Z" fill="#fff" opacity="0.35"/>` +
    sparkle(-64, -58, 9, p.c) +
    sparkle(66, -44, 7, p.c),
  bow: (p) =>
    `<path d="M-30 -96Q50 0 -30 96" stroke="#8B5A2B" stroke-width="10" fill="none" stroke-linecap="round"/>` +
    `<path d="M-30 -96L-30 96" stroke="${p.c}" stroke-width="2"/>` +
    `<path d="M-90 0L84 0" stroke="#5B3A12" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M84 0L66 -12L70 0L66 12Z" fill="${p.c}"/>` +
    `<path d="M-90 0L-104 -12M-90 0L-104 12M-80 0L-94 -12M-80 0L-94 12" stroke="${p.a}" stroke-width="4" stroke-linecap="round"/>` +
    flame(60, -42, 34) +
    sparkle(30, -70, 8, p.c),
  thali: (p) =>
    `<ellipse cx="0" cy="40" rx="104" ry="34" fill="${p.c}"/><ellipse cx="0" cy="34" rx="94" ry="26" fill="#F8D774"/>` +
    `<ellipse cx="0" cy="34" rx="80" ry="20" fill="none" stroke="${p.c}" stroke-width="3" stroke-dasharray="3 6"/>` +
    `<path d="M-30 30Q-28 46 -8 46Q12 46 14 30Z" fill="${p.b}"/>` +
    flame(-8, 30, 34) +
    `<circle cx="40" cy="32" r="12" fill="#E11D48"/><circle cx="62" cy="30" r="9" fill="#FB923C"/>` +
    marigold(-58, 30, 10) +
    `<circle cx="-34" cy="-40" r="10" fill="#E11D48"/><path d="M-34 -30L-34 -10" stroke="#E11D48" stroke-width="5" stroke-linecap="round"/>` +
    sparkle(54, -40, 9, p.c),
  sunrise: (p) =>
    `<circle cx="0" cy="20" r="62" fill="${p.c}"/>` +
    Array.from({ length: 12 }, (_, i) => {
      const a = (-180 + i * 16.4) * (Math.PI / 180);
      return `<path d="M${Math.cos(a) * 74} ${20 + Math.sin(a) * 74}L${Math.cos(a) * 100} ${20 + Math.sin(a) * 100}" stroke="${p.c}" stroke-width="6" stroke-linecap="round"/>`;
    }).join('') +
    `<path d="M-110 22Q-55 14 0 22T110 22L110 96Q0 104 -110 96Z" fill="${p.b}"/>` +
    [38, 54, 70]
      .map(
        (y, i) =>
          `<path d="M${-90 + i * 14} ${y}Q-20 ${y - 6} ${30 - i * 10} ${y}T${100 - i * 16} ${y}" stroke="#fff" stroke-width="3" fill="none" opacity="${0.7 - i * 0.18}"/>`,
      )
      .join(''),
  kites: (p) =>
    [
      [-40, -10, 1, p.a, p.c],
      [52, -40, 0.7, p.b, '#fff'],
    ]
      .map(
        ([x, y, s, c1, c2]) =>
          `<g transform="translate(${x} ${y}) scale(${s}) rotate(-12)"><path d="M0 -70L56 0L0 70L-56 0Z" fill="${c1}"/><path d="M0 -70L0 70M-56 0L56 0" stroke="${c2}" stroke-width="3"/><path d="M0 -70L56 0L0 0Z" fill="#fff" opacity="0.18"/>` +
          `<path d="M0 70Q-20 100 10 120T0 170" stroke="${c2}" stroke-width="2.5" fill="none"/><path d="M-8 96L8 96L0 108Z" fill="${c2}"/></g>`,
      )
      .join('') +
    `<path d="M-40 60Q-90 90 -110 100" stroke="#fff" stroke-width="1.5" fill="none" opacity="0.8"/>` +
    sparkle(84, 40, 8, p.c),
  pot: (p) =>
    `<path d="M-74 -6Q-90 70 0 74Q90 70 74 -6Z" fill="#B45309"/>` +
    `<path d="M-60 6Q0 20 60 6" stroke="${p.c}" stroke-width="5" fill="none"/>` +
    `<path d="M-56 22Q0 36 56 22" stroke="#FDE68A" stroke-width="3" fill="none" stroke-dasharray="3 7"/>` +
    `<ellipse cx="0" cy="-8" rx="76" ry="14" fill="#92400E"/>` +
    `<path d="M-60 -12C-50 -46 -20 -30 -10 -50C0 -30 30 -54 40 -30C56 -40 66 -24 62 -12Z" fill="#FFFBEB"/>` +
    // Sugarcane either side.
    [-96, 96]
      .map(
        (x) =>
          `<rect x="${x - 5}" y="-90" width="10" height="164" rx="5" fill="#6B8E23"/>` +
          [-60, -24, 12, 48]
            .map((y) => `<rect x="${x - 6}" y="${y}" width="12" height="4" fill="#3F5F10"/>`)
            .join('') +
          leaf(x, -90, 54, x < 0 ? -120 : -60, '#7CB342'),
      )
      .join(''),
  bonfire: (p) =>
    `<path d="M-70 70L60 40M-60 40L70 70" stroke="#7C4A1E" stroke-width="14" stroke-linecap="round"/>` +
    `<path d="M0 -84C40 -40 64 -8 50 30C40 56 -40 56 -50 30C-64 -8 -30 -30 -10 -56C-6 -36 6 -30 0 -84Z" fill="#F97316"/>` +
    `<path d="M0 -40C22 -14 34 8 26 30C18 46 -18 46 -26 30C-34 10 -16 -6 0 -40Z" fill="#FDE047"/>` +
    [
      [-60, -60],
      [54, -74],
      [70, -30],
      [-76, -20],
    ]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="${p.c}"/>`)
      .join(''),
  wheat: (p) =>
    [-40, 0, 40]
      .map(
        (a) =>
          `<g transform="rotate(${a * 0.6} 0 90)"><path d="M0 90L0 -60" stroke="#C99A2E" stroke-width="4"/>` +
          Array.from({ length: 7 }, (_, i) =>
            [-1, 1]
              .map(
                (s) =>
                  `<ellipse cx="${s * 9}" cy="${-56 + i * 15}" rx="7" ry="13" fill="${i % 2 ? '#E7B53C' : '#F4C95D'}" transform="rotate(${s * 24} ${s * 9} ${-56 + i * 15})"/>`,
              )
              .join(''),
          ).join('') +
          `<ellipse cx="0" cy="-70" rx="6" ry="12" fill="#F4C95D"/></g>`,
      )
      .join('') +
    `<path d="M-20 70Q0 60 20 70L14 86L-14 86Z" fill="${p.a}"/>` +
    sparkle(70, -60, 9, p.c),
  pookalam: (p) =>
    `<circle r="98" fill="#F97316"/>` +
    Array.from(
      { length: 16 },
      (_, i) =>
        `<ellipse cx="0" cy="-80" rx="13" ry="20" fill="#FDE047" transform="rotate(${i * 22.5})"/>`,
    ).join('') +
    `<circle r="70" fill="#DC2626"/>` +
    Array.from({ length: 12 }, (_, i) => petal(i * 30, 60, 13, '#FFFFFF')).join('') +
    `<circle r="34" fill="#16A34A"/>` +
    Array.from({ length: 8 }, (_, i) => petal(i * 45, 30, 8, '#FACC15')).join('') +
    `<circle r="10" fill="${p.c}"/>`,
  toran: (p) =>
    `<path d="M-110 -70Q0 -40 110 -70" stroke="#8B5A2B" stroke-width="4" fill="none"/>` +
    Array.from({ length: 9 }, (_, i) => {
      const x = -96 + i * 24;
      const y = -70 + 30 * Math.sin((i / 8) * Math.PI) * 0.9;
      return (
        `<path d="M${x} ${y}C${x - 12} ${y + 24} ${x - 6} ${y + 50} ${x} ${y + 62}C${x + 6} ${y + 50} ${x + 12} ${y + 24} ${x} ${y}Z" fill="${i % 2 ? '#2F855A' : '#48BB78'}"/>` +
        `<path d="M${x} ${y + 4}L${x} ${y + 56}" stroke="#22543D" stroke-width="1.5"/>`
      );
    }).join('') +
    [-72, -24, 24, 72]
      .map((x) => marigold(x, -58 + 18 * Math.sin(((x + 96) / 192) * Math.PI), 9))
      .join('') +
    // Gudi: a raised pole with cloth and a pot.
    `<rect x="-3" y="-4" width="6" height="104" fill="#8B5A2B"/><path d="M-26 2L26 2L18 52L-18 52Z" fill="${p.a}"/><path d="M-26 2L26 2L22 14L-22 14Z" fill="${p.c}"/>` +
    `<circle cx="0" cy="-6" r="12" fill="#B7791F"/>`,
  crescent: (p) =>
    moon(-6, -10, 64, p.c) +
    sparkle(52, -54, 12, p.c) +
    sparkle(70, 10, 7, '#fff') +
    [0, 1, 2].map((i) => leaf(-60 + i * 36, 70, 40, -70 + i * 20, '#3F8F4F')).join(''),
  crescentLantern: (p) =>
    moon(-50, -30, 50, p.c) +
    sparkle(-2, -70, 9, p.c) +
    `<path d="M56 -100L56 -64" stroke="${p.c}" stroke-width="2"/>` +
    `<g transform="translate(56 0)"><path d="M-16 -64L16 -64L22 -52L-22 -52Z" fill="${p.c}"/>` +
    `<path d="M-26 -52Q-34 0 -20 40L20 40Q34 0 26 -52Z" fill="${p.a}"/>` +
    `<path d="M-14 -40Q-20 0 -10 30L10 30Q20 0 14 -40Z" fill="#FFE8A3"/>` +
    flame(0, 16, 26) +
    `<path d="M-24 40L24 40L16 54L-16 54Z" fill="${p.c}"/>` +
    `<path d="M-26 -52Q-34 0 -20 40M26 -52Q34 0 20 40M0 -52L0 40" stroke="${p.c}" stroke-width="2.5" fill="none"/></g>`,
  dome: (p) =>
    `<path d="M-60 80L-60 10Q-60 -40 0 -60Q60 -40 60 10L60 80Z" fill="${p.b}"/>` +
    `<path d="M-60 10Q-60 -40 0 -60Q60 -40 60 10Z" fill="${p.a}"/>` +
    `<path d="M0 -60L0 -84" stroke="${p.c}" stroke-width="3"/>` +
    moon(0, -92, 10, p.c, -10) +
    `<path d="M-14 80L-14 40Q0 24 14 40L14 80Z" fill="${p.d}" opacity="0.7"/>` +
    [-96, 96]
      .map(
        (x) =>
          `<rect x="${x - 9}" y="-40" width="18" height="120" fill="${p.b}"/><path d="M${x - 12} -40L${x} -66L${x + 12} -40Z" fill="${p.a}"/>` +
          `<rect x="${x - 12}" y="0" width="24" height="5" fill="${p.c}"/>`,
      )
      .join('') +
    sparkle(-40, -80, 7, p.c),
  tulips: (p) =>
    [
      [-46, p.a, -14],
      [0, p.b, 0],
      [46, p.a, 14],
    ]
      .map(
        ([x, c, r]) =>
          `<g transform="rotate(${r} 0 90)"><path d="M${x} 90Q${Number(x) * 0.6} 20 ${x} -20" stroke="#3F8F4F" stroke-width="5" fill="none"/>` +
          leaf(Number(x), 40, 44, Number(x) < 0 ? -140 : -40, '#4CAF50') +
          `<path d="M${Number(x) - 24} -40Q${Number(x) - 26} -6 ${x} -2Q${Number(x) + 26} -6 ${Number(x) + 24} -40L${Number(x) + 12} -26L${x} -48L${Number(x) - 12} -26Z" fill="${c}"/></g>`,
      )
      .join('') + `<path d="M-30 70L30 70L22 98L-22 98Z" fill="${p.c}"/>`,
  tricolour: () =>
    [
      ['#FF9933', -40],
      ['#FFFFFF', 0],
      ['#138808', 40],
    ]
      .map(
        ([c, y]) =>
          `<path d="M-110 ${Number(y) - 18}C-50 ${Number(y) - 40} 10 ${Number(y) + 10} 110 ${Number(y) - 22}L110 ${Number(y) + 14}C10 ${Number(y) + 46} -50 ${Number(y) - 4} -110 ${Number(y) + 18}Z" fill="${c}"/>`,
      )
      .join('') +
    `<circle cx="0" cy="-6" r="16" fill="none" stroke="#000080" stroke-width="3"/>` +
    Array.from(
      { length: 12 },
      (_, i) =>
        `<path d="M0 -6L${Math.cos((i * Math.PI) / 6) * 16} ${-6 + Math.sin((i * Math.PI) / 6) * 16}" stroke="#000080" stroke-width="1.6"/>`,
    ).join(''),
  fireworks: (p) =>
    [
      [-50, -30, 54, p.c],
      [52, -50, 40, p.a],
      [40, 40, 30, '#fff'],
      [-60, 50, 24, p.b],
    ]
      .map(([x, y, r, c]) =>
        Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2;
          const R = Number(r);
          return (
            `<path d="M${Number(x) + Math.cos(a) * R * 0.3} ${Number(y) + Math.sin(a) * R * 0.3}L${Number(x) + Math.cos(a) * R} ${Number(y) + Math.sin(a) * R}" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>` +
            `<circle cx="${Number(x) + Math.cos(a) * (R + 8)}" cy="${Number(y) + Math.sin(a) * (R + 8)}" r="2.6" fill="${c}"/>`
          );
        }).join(''),
      )
      .join('') +
    sparkle(0, -90, 8, p.c) +
    sparkle(90, 0, 7, '#fff'),
  tree: (p) =>
    `<rect x="-12" y="70" width="24" height="26" fill="#7C4A1E"/>` +
    `<path d="M0 -90L70 76L-70 76Z" fill="#1F7A4D"/><path d="M0 -90L50 20L-50 20Z" fill="#2E9E62"/><path d="M0 -90L30 -30L-30 -30Z" fill="#3DBB76"/>` +
    `<path d="M-50 20Q0 40 50 20M-62 56Q0 78 62 56M-30 -30Q0 -16 30 -30" stroke="${p.c}" stroke-width="3" fill="none"/>` +
    [
      [-30, 40, '#E11D48'],
      [24, 46, p.c],
      [-10, 0, '#3B82F6'],
      [20, -10, '#E11D48'],
      [-40, 64, p.c],
      [44, 66, '#3B82F6'],
    ]
      .map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="6" fill="${c}"/>`)
      .join('') +
    sparkle(0, -96, 16, p.c) +
    `<rect x="40" y="76" width="34" height="24" fill="${p.a}"/><rect x="54" y="76" width="6" height="24" fill="${p.c}"/>`,
  lanterns: (p) =>
    `<path d="M-110 -80Q0 -50 110 -80" stroke="${p.c}" stroke-width="2" fill="none"/>` +
    [
      [-60, -64, 1],
      [0, -56, 1.2],
      [60, -64, 1],
    ]
      .map(
        ([x, y, s]) =>
          `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0L0 10" stroke="${p.c}" stroke-width="2"/><rect x="-14" y="10" width="28" height="6" fill="${p.c}"/>` +
          `<ellipse cx="0" cy="46" rx="34" ry="32" fill="${p.a}"/><ellipse cx="0" cy="46" rx="20" ry="32" fill="none" stroke="${p.b}" stroke-width="2"/><ellipse cx="0" cy="46" rx="6" ry="32" fill="none" stroke="${p.b}" stroke-width="2"/>` +
          `<rect x="-14" y="76" width="28" height="6" fill="${p.c}"/><path d="M-6 82L-6 104M0 82L0 108M6 82L6 104" stroke="${p.c}" stroke-width="2"/></g>`,
      )
      .join(''),
  eggs: (p) =>
    [
      [-46, 20, p.a, -12],
      [42, 24, p.b, 10],
      [0, 4, p.c, 0],
    ]
      .map(
        ([x, y, c, r]) =>
          `<g transform="translate(${x} ${y}) rotate(${r})"><path d="M0 -50C26 -50 38 -6 38 18C38 42 20 54 0 54C-20 54 -38 42 -38 18C-38 -6 -26 -50 0 -50Z" fill="${c}"/>` +
          `<path d="M-36 6Q-18 -6 0 6T36 6" stroke="#fff" stroke-width="4" fill="none"/><path d="M-36 26Q-18 38 0 26T36 26" stroke="#fff" stroke-width="3" fill="none" stroke-dasharray="2 6" stroke-linecap="round"/></g>`,
      )
      .join('') +
    [-80, -60, 70, 90].map((x, i) => leaf(x, 80, 34, -100 + i * 30, '#7CC36F')).join(''),
  menorah: (p) =>
    `<rect x="-40" y="78" width="80" height="10" rx="4" fill="${p.c}"/><rect x="-4" y="-10" width="8" height="90" fill="${p.c}"/>` +
    [1, 2, 3, 4]
      .map(
        (i) =>
          `<path d="M${-i * 22} -10Q${-i * 22} ${30 + i * 8} 0 ${30 + i * 8}Q${i * 22} ${30 + i * 8} ${i * 22} -10" stroke="${p.c}" stroke-width="6" fill="none"/>`,
      )
      .join('') +
    [-88, -66, -44, -22, 0, 22, 44, 66, 88]
      .map(
        (x) =>
          `<rect x="${x - 5}" y="${x === 0 ? -42 : -30}" width="10" height="${x === 0 ? 32 : 20}" fill="#fff"/>` +
          flame(x, x === 0 ? -44 : -32, 20),
      )
      .join(''),
  leaves: (p) =>
    [
      [-40, -20, 80, -30, '#C2410C'],
      [20, -40, 70, 20, '#D97706'],
      [40, 20, 64, 70, '#B91C1C'],
      [-30, 30, 60, 160, '#EAB308'],
    ]
      .map(([x, y, l, a, c]) => leaf(Number(x), Number(y), Number(l), Number(a), String(c)))
      .join('') +
    `<circle cx="70" cy="-60" r="12" fill="#92400E"/><path d="M70 -72Q74 -84 82 -86" stroke="#14532D" stroke-width="3" fill="none"/>` +
    `<circle cx="-74" cy="56" r="10" fill="#92400E"/>` +
    sparkle(0, 80, 7, p.c),
  hearts: (p) =>
    heart(-30, 0, 46, p.a) +
    heart(44, -30, 30, p.b) +
    heart(40, 50, 22, p.c) +
    heart(-74, -60, 14, '#fff', 'opacity="0.8"') +
    `<path d="M-60 -8Q-44 -26 -26 -22" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.6"/>`,
  bouquet: (p) =>
    `<path d="M-40 10L40 10L10 96L-10 96Z" fill="${p.c}"/><path d="M-40 10L40 10L30 30L-30 30Z" fill="#fff" opacity="0.3"/>` +
    leaf(-40, 0, 50, -150, '#3F8F4F') +
    leaf(40, 0, 50, -30, '#3F8F4F') +
    flower(-36, -30, 34, p.a, p.c) +
    flower(34, -36, 32, p.b, p.c) +
    flower(0, -64, 34, p.a, '#fff') +
    flower(0, -10, 28, '#fff', p.c),
  tie: (p) =>
    `<path d="M-4 -78L-60 -96L-44 -40Z" fill="#fff"/><path d="M4 -78L60 -96L44 -40Z" fill="#F1F5F9"/>` +
    `<path d="M-14 -64L14 -64L20 -40L-20 -40Z" fill="${p.a}"/>` +
    `<path d="M-20 -40L20 -40L32 60L0 92L-32 60Z" fill="${p.a}"/>` +
    [-20, 0, 20, 40]
      .map((y) => `<path d="M-24 ${y}L28 ${y - 18}" stroke="${p.c}" stroke-width="5"/>`)
      .join('') +
    sparkle(70, 30, 10, p.c),
  twoHearts: (p) =>
    heart(-26, 4, 50, p.a) +
    `<g opacity="0.95">${heart(30, 10, 44, p.b)}</g>` +
    `<path d="M-100 70Q0 40 100 70" stroke="${p.c}" stroke-width="3" fill="none" stroke-dasharray="1 8" stroke-linecap="round"/>` +
    sparkle(80, -60, 10, p.c) +
    sparkle(-84, -50, 7, '#fff'),
  books: (p) =>
    `<rect x="-80" y="40" width="150" height="26" rx="4" fill="${p.a}"/><rect x="-70" y="14" width="140" height="26" rx="4" fill="${p.b}"/><rect x="-60" y="-12" width="128" height="26" rx="4" fill="${p.c}"/>` +
    `<rect x="-80" y="48" width="150" height="4" fill="#fff" opacity="0.5"/><rect x="-70" y="22" width="140" height="4" fill="#fff" opacity="0.5"/>` +
    `<circle cx="26" cy="-46" r="30" fill="#DC2626"/><circle cx="14" cy="-54" r="8" fill="#fff" opacity="0.35"/>` +
    `<path d="M26 -76Q30 -90 40 -94" stroke="#5B3A12" stroke-width="4" fill="none"/>` +
    leaf(30, -80, 26, -30, '#16A34A'),
  cake: (p) =>
    `<rect x="-80" y="10" width="160" height="70" rx="10" fill="${p.a}"/><rect x="-66" y="-36" width="132" height="50" rx="10" fill="${p.b}"/>` +
    `<path d="M-80 20Q-60 44 -40 20T0 20T40 20T80 20" fill="#fff" opacity="0.95"/><path d="M-66 -28Q-50 -8 -33 -28T0 -28T33 -28T66 -28" fill="#fff"/>` +
    `<ellipse cx="0" cy="82" rx="96" ry="10" fill="${p.c}"/>` +
    [-36, 0, 36]
      .map(
        (x, i) =>
          `<rect x="${x - 4}" y="-72" width="8" height="36" rx="3" fill="${i % 2 ? p.c : '#fff'}"/>` +
          flame(x, -72, 24),
      )
      .join('') +
    [-50, -20, 20, 50]
      .map((x, i) => `<circle cx="${x}" cy="50" r="5" fill="${i % 2 ? p.c : '#fff'}"/>`)
      .join(''),
  rings: (p) =>
    `<circle cx="-28" cy="20" r="46" fill="none" stroke="${p.c}" stroke-width="12"/>` +
    `<circle cx="32" cy="20" r="46" fill="none" stroke="#E5E7EB" stroke-width="12"/>` +
    `<path d="M-28 -26L-40 -40L-28 -58L-16 -40Z" fill="#E0F2FE"/><path d="M-28 -58L-16 -40L-28 -26Z" fill="#BAE6FD"/>` +
    heart(0, -84, 14, p.a) +
    sparkle(76, -40, 9, p.c) +
    sparkle(-84, -20, 6, '#fff'),
  babyMoon: (p) =>
    `<path d="M-110 -90Q0 -60 110 -90" stroke="${p.c}" stroke-width="2" fill="none"/>` +
    moon(-4, 10, 54, p.c) +
    [
      [-70, -40, p.a],
      [70, -50, p.b],
      [-40, 70, p.b],
      [60, 50, p.a],
    ]
      .map(
        ([x, y, c]) =>
          `<path d="M${x} -82L${x} ${Number(y) - 12}" stroke="${p.c}" stroke-width="1.5"/>` +
          sparkle(Number(x), Number(y), 13, String(c)),
      )
      .join('') +
    `<circle cx="-30" cy="24" r="3" fill="#fff" opacity="0.6"/>`,
  cap: (p) =>
    `<path d="M0 -60L110 -16L0 28L-110 -16Z" fill="#1F2937"/><path d="M0 -60L110 -16L0 -4Z" fill="#374151"/>` +
    `<path d="M-60 4L-60 50Q0 80 60 50L60 4L0 28Z" fill="#111827"/>` +
    `<path d="M0 -16L84 0L84 50" stroke="${p.c}" stroke-width="4" fill="none"/><path d="M76 50L92 50L88 76L80 76Z" fill="${p.c}"/>` +
    `<circle cx="0" cy="-16" r="6" fill="${p.c}"/>` +
    sparkle(-84, -64, 10, p.c) +
    sparkle(90, -70, 7, '#fff'),
  house: (p) =>
    `<rect x="-64" y="-10" width="128" height="92" fill="#FFF7ED"/><path d="M-86 0L0 -76L86 0Z" fill="${p.a}"/>` +
    `<rect x="44" y="-66" width="16" height="34" fill="${p.b}"/>` +
    `<rect x="-16" y="30" width="32" height="52" rx="4" fill="${p.b}"/><circle cx="8" cy="58" r="3" fill="${p.c}"/>` +
    `<rect x="-52" y="14" width="26" height="24" fill="#BFDBFE"/><rect x="26" y="14" width="26" height="24" fill="#BFDBFE"/>` +
    `<path d="M-39 14L-39 38M-52 26L-26 26M39 14L39 38M26 26L52 26" stroke="#FFF7ED" stroke-width="2"/>` +
    heart(0, -32, 12, p.c) +
    leaf(-90, 76, 30, -60, '#4CAF50') +
    leaf(86, 76, 30, -120, '#4CAF50'),
  clover: (p) =>
    [0, 90, 180, 270]
      .map(
        (a) =>
          `<g transform="rotate(${a + 45})">${heart(0, -34, 30, a % 180 ? '#22A25A' : '#2DBE6C')}</g>`,
      )
      .join('') +
    `<path d="M4 10Q20 60 6 96" stroke="#15803D" stroke-width="7" fill="none" stroke-linecap="round"/>` +
    sparkle(70, -60, 10, p.c) +
    sparkle(-74, 50, 7, p.c),
  medal: (p) =>
    `<path d="M-40 -96L-8 -20L-30 -16L-62 -92Z" fill="${p.a}"/><path d="M40 -96L8 -20L30 -16L62 -92Z" fill="${p.b}"/>` +
    `<circle cx="0" cy="26" r="58" fill="${p.c}"/><circle cx="0" cy="26" r="44" fill="#FDE68A"/>` +
    `<path d="M0 -2L9 18L30 20L14 34L19 56L0 44L-19 56L-14 34L-30 20L-9 18Z" fill="${p.c}"/>` +
    sparkle(70, -20, 10, '#fff'),
  rise: (p) =>
    [
      [-70, 40, 30],
      [-30, 10, 60],
      [10, -20, 90],
      [50, -50, 120],
    ]
      .map(
        ([x, y, h], i) =>
          `<rect x="${x}" y="${y}" width="30" height="${h}" rx="4" fill="${i % 2 ? p.b : p.a}"/>`,
      )
      .join('') +
    `<path d="M-90 30L-40 0L0 -20L60 -80" stroke="${p.c}" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M66 -86L36 -82L62 -56Z" fill="${p.c}"/>` +
    sparkle(80, -90, 10, p.c),
  balloons: (p) =>
    [
      [-46, -20, p.a],
      [0, -46, p.c],
      [46, -24, p.b],
    ]
      .map(
        ([x, y, c]) =>
          `<path d="M${x} ${Number(y) + 46}Q${Number(x) + 10} ${Number(y) + 80} 0 96" stroke="#fff" stroke-width="2" fill="none" opacity="0.9"/>` +
          `<ellipse cx="${x}" cy="${y}" rx="34" ry="42" fill="${c}"/><path d="M${Number(x) - 6} ${Number(y) + 42}L${Number(x) + 6} ${Number(y) + 42}L${x} ${Number(y) + 50}Z" fill="${c}"/>` +
          `<ellipse cx="${Number(x) - 12}" cy="${Number(y) - 16}" rx="8" ry="13" fill="#fff" opacity="0.4"/>`,
      )
      .join(''),
  plane: (p) =>
    `<path d="M-110 70Q-60 20 -20 50T50 10" stroke="#fff" stroke-width="3" fill="none" stroke-dasharray="4 10" stroke-linecap="round" opacity="0.9"/>` +
    `<path d="M100 -70L-30 -10L20 8Z" fill="#fff"/><path d="M100 -70L20 8L36 60Z" fill="#E5E7EB"/><path d="M100 -70L20 8L10 34Z" fill="#CBD5E1"/>` +
    heart(-70, -40, 12, p.c) +
    sparkle(-20, -70, 8, p.c),
  popper: (p) =>
    `<path d="M-90 90L-40 -10L10 40Z" fill="${p.a}"/><path d="M-90 90L-60 30L-30 62Z" fill="${p.b}"/>` +
    `<path d="M-40 -10L10 40" stroke="${p.c}" stroke-width="6"/>` +
    [
      [0, -40, '#FF3D7F', 20],
      [30, -10, '#FFC400', -30],
      [40, -70, '#00B3A4', 50],
      [70, -30, '#6C4DFF', 10],
      [-10, -80, '#FF7A00', -60],
      [80, 10, '#FF3D7F', 70],
    ]
      .map(
        ([x, y, c, r]) =>
          `<rect x="${x}" y="${y}" width="16" height="7" rx="2" fill="${c}" transform="rotate(${r} ${x} ${y})"/>`,
      )
      .join('') +
    `<path d="M10 -20Q30 -60 60 -60" stroke="${p.c}" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M20 10Q60 0 80 -20" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>` +
    sparkle(90, -80, 9, p.c),
  envelope: (p) =>
    `<rect x="-90" y="-40" width="180" height="120" rx="8" fill="#FFF7ED"/>` +
    `<path d="M-90 -36L0 30L90 -36" stroke="#E7D7C4" stroke-width="4" fill="none"/>` +
    `<path d="M-90 80L-20 20M90 80L20 20" stroke="#E7D7C4" stroke-width="3"/>` +
    heart(0, 22, 26, p.a) +
    heart(-60, -80, 14, p.b) +
    heart(56, -88, 18, p.c) +
    heart(6, -96, 10, p.a),
  trophy: (p) =>
    `<path d="M-50 -76L50 -76L44 -10Q30 30 0 30Q-30 30 -44 -10Z" fill="${p.c}"/>` +
    `<path d="M-50 -66Q-90 -66 -80 -30Q-72 -6 -42 -12M50 -66Q90 -66 80 -30Q72 -6 42 -12" stroke="${p.c}" stroke-width="8" fill="none"/>` +
    `<rect x="-10" y="30" width="20" height="30" fill="${p.c}"/><rect x="-44" y="60" width="88" height="24" rx="4" fill="${p.a}"/>` +
    `<path d="M-30 -66L-26 -16" stroke="#fff" stroke-width="6" opacity="0.4" stroke-linecap="round"/>` +
    `<path d="M0 -60L7 -44L24 -42L11 -31L15 -14L0 -23L-15 -14L-11 -31L-24 -42L-7 -44Z" fill="#fff" opacity="0.85"/>` +
    sparkle(80, -80, 10, p.c) +
    sparkle(-84, 40, 8, '#fff'),
  rocket: (p) =>
    `<g transform="rotate(35)"><path d="M0 -96C30 -70 34 -20 26 30L-26 30C-34 -20 -30 -70 0 -96Z" fill="#F8FAFC"/>` +
    `<circle cx="0" cy="-34" r="14" fill="${p.b}"/><circle cx="0" cy="-34" r="8" fill="#BFDBFE"/>` +
    `<path d="M-26 0L-50 40L-24 30Z" fill="${p.a}"/><path d="M26 0L50 40L24 30Z" fill="${p.a}"/><path d="M0 -96C12 -86 20 -74 24 -62L-24 -62C-20 -74 -12 -86 0 -96Z" fill="${p.a}"/>` +
    `<path d="M-16 30L16 30L0 84Z" fill="#FB923C"/><path d="M-8 30L8 30L0 62Z" fill="#FDE047"/></g>` +
    [
      [-80, -60],
      [70, -80],
      [-60, 70],
    ]
      .map(([x, y]) => sparkle(x!, y!, 8, p.c))
      .join(''),
  flowerVase: (p) =>
    `<path d="M-30 20Q-50 60 -24 96L24 96Q50 60 30 20Z" fill="${p.b}"/><rect x="-32" y="12" width="64" height="12" rx="4" fill="${p.c}"/>` +
    `<path d="M0 14Q-10 -30 -40 -54M0 14Q4 -40 10 -74M0 14Q20 -20 50 -40" stroke="#3F8F4F" stroke-width="4" fill="none"/>` +
    leaf(-20, -10, 30, -150, '#4CAF50') +
    leaf(20, -10, 30, -30, '#4CAF50') +
    flower(-40, -56, 26, p.a, p.c) +
    flower(10, -78, 24, '#fff', p.c) +
    flower(52, -42, 22, p.a, '#fff'),
  candle: (p) =>
    `<circle cx="0" cy="-48" r="50" fill="#FFE8A3" opacity="0.22"/>` +
    `<rect x="-24" y="-24" width="48" height="110" rx="6" fill="#F8F4EC"/><rect x="-24" y="-24" width="14" height="110" fill="#fff" opacity="0.5"/>` +
    `<path d="M0 -24L0 -34" stroke="#3F3F46" stroke-width="2"/>` +
    flame(0, -34, 40) +
    leaf(-40, 86, 46, -160, p.b) +
    leaf(40, 86, 46, -20, p.b) +
    `<ellipse cx="0" cy="88" rx="60" ry="6" fill="#000" opacity="0.15"/>`,
  mooncake: (p) =>
    `<circle cx="-50" cy="-46" r="40" fill="${p.c}" opacity="0.95"/>` +
    `<ellipse cx="20" cy="74" rx="90" ry="12" fill="#000" opacity="0.15"/>` +
    [
      [-4, 30, 50],
      [62, 44, 36],
    ]
      .map(
        ([x, y, r]) =>
          `<circle cx="${x}" cy="${y}" r="${r}" fill="#C27B2C"/><circle cx="${x}" cy="${y! - 4}" r="${r! - 6}" fill="#E09B45"/>` +
          Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2;
            return `<circle cx="${x! + Math.cos(a) * (r! - 6)}" cy="${y! - 4 + Math.sin(a) * (r! - 6)}" r="${r! * 0.16}" fill="#E09B45"/>`;
          }).join('') +
          `<circle cx="${x}" cy="${y! - 4}" r="${r! * 0.5}" fill="none" stroke="#A4621E" stroke-width="2.5"/>` +
          flower(x!, y! - 4, r! * 0.32, '#A4621E', '#C27B2C', 4),
      )
      .join('') +
    sparkle(80, -60, 9, p.c),
  fullMoon: (p) =>
    `<circle cx="0" cy="-20" r="62" fill="${p.c}"/><circle cx="-20" cy="-34" r="10" fill="#000" opacity="0.06"/><circle cx="18" cy="-6" r="14" fill="#000" opacity="0.06"/>` +
    `<path d="M-110 70Q-60 30 -10 60T110 50L110 100L-110 100Z" fill="${p.b}"/>` +
    [
      [-70, 40],
      [-40, 56],
      [60, 36],
    ]
      .map(
        ([x, y]) =>
          `<circle cx="${x}" cy="${y}" r="11" fill="#F97316"/><path d="M${x! - 5} ${y! - 10}L${x! + 5} ${y! - 10}L${x} ${y! - 6}Z" fill="#3F6212"/>`,
      )
      .join('') +
    sparkle(84, -70, 8, '#fff'),
  appleHoney: (p) =>
    `<path d="M-20 -50C-70 -70 -100 -20 -90 20C-80 60 -50 80 -20 70C-10 66 -10 66 0 70C30 80 60 60 66 20C74 -20 40 -70 -20 -50Z" fill="#DC2626"/>` +
    `<path d="M-60 -30C-70 -10 -70 10 -62 26" stroke="#fff" stroke-width="6" fill="none" opacity="0.35" stroke-linecap="round"/>` +
    `<path d="M-20 -50Q-18 -76 -6 -88" stroke="#5B3A12" stroke-width="5" fill="none"/>` +
    leaf(-12, -80, 34, -20, '#16A34A') +
    `<path d="M50 20L106 20L100 90L56 90Z" fill="#FCD34D" opacity="0.9"/><rect x="46" y="12" width="64" height="12" rx="4" fill="${p.c}"/>` +
    `<path d="M66 60Q78 50 90 60" stroke="#D97706" stroke-width="3" fill="none"/>` +
    sparkle(90, -60, 9, p.c),
  cup: (p) =>
    `<path d="M-40 -70L40 -70Q40 0 0 10Q-40 0 -40 -70Z" fill="${p.c}"/><path d="M-34 -56L34 -56Q32 -10 0 -2Q-32 -10 -34 -56Z" fill="#7F1D1D"/>` +
    `<rect x="-5" y="8" width="10" height="56" fill="${p.c}"/><ellipse cx="0" cy="68" rx="40" ry="10" fill="${p.c}"/>` +
    [-80, 70]
      .map(
        (x) =>
          `<rect x="${x - 26}" y="40" width="62" height="44" rx="4" fill="#F5E6C8"/>` +
          [0, 1, 2, 3]
            .map(
              (i) =>
                `<path d="M${x - 20} ${50 + i * 10}L${x + 30} ${50 + i * 10}" stroke="#D4B483" stroke-width="2" stroke-dasharray="2 5"/>`,
            )
            .join(''),
      )
      .join('') +
    sparkle(74, -60, 9, p.c),
  kinara: () =>
    `<path d="M-100 40L100 40L80 70L-80 70Z" fill="#7C4A1E"/><rect x="-100" y="34" width="200" height="10" rx="3" fill="#92400E"/>` +
    ['#DC2626', '#DC2626', '#DC2626', '#111827', '#16A34A', '#16A34A', '#16A34A']
      .map((c, i) => {
        const x = -84 + i * 28;
        return (
          `<rect x="${x - 7}" y="-30" width="14" height="64" rx="2" fill="${c}"/>` +
          flame(x, -32, 24)
        );
      })
      .join(''),
  mask: (p) =>
    `<path d="M-100 -20C-60 -40 -20 -30 0 -14C20 -30 60 -40 100 -20C100 30 60 50 20 30C10 24 -10 24 -20 30C-60 50 -100 30 -100 -20Z" fill="${p.a}"/>` +
    `<path d="M-70 -4C-56 -14 -38 -14 -28 -2C-40 8 -60 8 -70 -4ZM70 -4C56 -14 38 -14 28 -2C40 8 60 8 70 -4Z" fill="#111827"/>` +
    `<path d="M-100 -20C-60 -40 -20 -30 0 -14C20 -30 60 -40 100 -20" stroke="${p.c}" stroke-width="5" fill="none"/>` +
    [0, 1, 2]
      .map(
        (i) =>
          `<path d="M${60 + i * 10} -30Q${70 + i * 18} -90 ${110 + i * 4} -${100 - i * 10}" stroke="${[p.b, p.c, '#22C55E'][i]}" stroke-width="7" fill="none" stroke-linecap="round"/>`,
      )
      .join('') +
    `<path d="M-100 0L-120 70" stroke="${p.c}" stroke-width="5" stroke-linecap="round"/>` +
    [-60, -30, 30, 60]
      .map((x, i) => `<circle cx="${x}" cy="${i % 3 ? 22 : 18}" r="4" fill="${p.c}"/>`)
      .join(''),
  pumpkin: (p) =>
    `<ellipse cx="0" cy="20" rx="96" ry="70" fill="#EA580C"/>` +
    [-56, -20, 20, 56]
      .map(
        (x) =>
          `<ellipse cx="${x}" cy="20" rx="34" ry="68" fill="none" stroke="#C2410C" stroke-width="4"/>`,
      )
      .join('') +
    `<path d="M-6 -48Q-4 -76 14 -84" stroke="#3F6212" stroke-width="10" fill="none" stroke-linecap="round"/>` +
    `<path d="M-50 -4L-26 -4L-38 -26Z M26 -4L50 -4L38 -26Z" fill="#FDE047"/>` +
    `<path d="M-56 30Q0 70 56 30L44 40L32 32L20 44L8 34L-8 44L-20 34L-32 44L-44 34Z" fill="#FDE047"/>` +
    sparkle(80, -70, 9, p.c) +
    `<path d="M-90 -80Q-80 -90 -70 -80Q-60 -90 -50 -80Q-60 -76 -70 -70Q-80 -76 -90 -80Z" fill="#111827" opacity="0.8"/>`,
  marigolds: (p) =>
    `<path d="M-110 70Q0 20 110 70" stroke="#16A34A" stroke-width="3" fill="none"/>` +
    [
      [-70, -10, 30],
      [-10, -40, 36],
      [56, -14, 30],
      [-40, 50, 22],
      [30, 46, 24],
      [86, 40, 18],
      [-92, 40, 16],
    ]
      .map(([x, y, r], i) =>
        i % 2
          ? marigold(x!, y!, r!)
          : marigold(x!, y!, r!)
              .replace(/#F59E0B/, '#EA580C')
              .replace(/#FBBF24/, '#F97316'),
      )
      .join('') +
    sparkle(0, -96, 9, p.c),
  waterSplash: (p) =>
    `<path d="M0 -90C30 -40 50 -10 50 20C50 50 28 70 0 70C-28 70 -50 50 -50 20C-50 -10 -30 -40 0 -90Z" fill="#38BDF8"/>` +
    `<path d="M-26 10C-26 30 -12 46 4 48" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" opacity="0.6"/>` +
    [
      [-80, -40, 12],
      [80, -30, 14],
      [-70, 50, 10],
      [86, 50, 9],
      [60, -80, 8],
      [-60, -80, 7],
    ]
      .map(
        ([x, y, r]) =>
          `<path d="M${x} ${y! - r! * 1.6}C${x! + r!} ${y! - r! * 0.4} ${x! + r!} ${y! + r!} ${x} ${y! + r!}C${x! - r!} ${y! + r!} ${x! - r!} ${y! - r! * 0.4} ${x} ${y! - r! * 1.6}Z" fill="#7DD3FC"/>`,
      )
      .join('') +
    flower(-90, 0, 18, p.a, p.c, 5) +
    flower(92, 6, 16, p.b, p.c, 5),
  globe: (p) =>
    `<circle r="76" fill="#2563EB"/>` +
    `<path d="M-50 -50C-30 -60 -10 -40 -20 -20C-30 0 -60 -4 -66 -20C-70 -32 -60 -44 -50 -50Z M10 -70C30 -66 50 -50 40 -30C30 -10 10 -20 6 -36C2 -50 0 -66 10 -70Z M-10 10C20 0 50 10 56 30C60 50 30 66 10 56C-10 46 -30 30 -10 10Z" fill="#22C55E"/>` +
    `<circle r="76" fill="none" stroke="#fff" stroke-width="3" opacity="0.4"/>` +
    `<path d="M-60 -40Q-50 -60 -30 -68" stroke="#fff" stroke-width="6" fill="none" opacity="0.4" stroke-linecap="round"/>` +
    leaf(-90, 70, 40, -70, '#16A34A') +
    leaf(90, 70, 40, -110, '#16A34A') +
    heart(70, -70, 14, p.c),
  sapling: (p) =>
    `<path d="M-90 70Q0 40 90 70L90 90L-90 90Z" fill="#92400E"/>` +
    `<path d="M0 66Q-4 10 0 -30" stroke="#15803D" stroke-width="7" fill="none" stroke-linecap="round"/>` +
    leaf(0, -20, 70, -150, '#22C55E') +
    leaf(0, -30, 76, -30, '#16A34A') +
    leaf(0, 20, 44, -170, '#4ADE80') +
    `<circle cx="70" cy="-60" r="26" fill="${p.c}" opacity="0.9"/>` +
    [-80, -50]
      .map(
        (x) =>
          `<path d="M${x} -40Q${x + 10} -70 ${x} -90" stroke="#7DD3FC" stroke-width="3" fill="none" stroke-dasharray="2 8" stroke-linecap="round"/>`,
      )
      .join(''),
  yogaPose: (p) =>
    `<circle cx="0" cy="-30" r="80" fill="${p.c}" opacity="0.35"/>` +
    `<circle cx="0" cy="-60" r="15" fill="#fff"/>` +
    `<path d="M0 -44L0 10" stroke="#fff" stroke-width="16" stroke-linecap="round"/>` +
    `<path d="M0 -28L-40 -60M0 -28L40 -60" stroke="#fff" stroke-width="9" stroke-linecap="round"/>` +
    `<path d="M-60 40Q-30 10 0 20Q30 10 60 40Q30 34 0 36Q-30 34 -60 40Z" fill="#fff"/>` +
    `<ellipse cx="0" cy="60" rx="96" ry="10" fill="${p.a}" opacity="0.8"/>` +
    leaf(-90, 40, 34, -60, '#16A34A') +
    leaf(90, 40, 34, -120, '#16A34A'),
  gear: (p) =>
    `<g transform="translate(-20 0)">` +
    Array.from(
      { length: 10 },
      (_, i) =>
        `<rect x="-10" y="-74" width="20" height="24" rx="3" fill="${p.c}" transform="rotate(${i * 36})"/>`,
    ).join('') +
    `<circle r="56" fill="${p.c}"/><circle r="22" fill="${p.d}"/></g>` +
    `<g transform="rotate(40 50 40)"><rect x="40" y="-40" width="18" height="120" rx="6" fill="#94A3B8"/><path d="M28 -60L70 -60L70 -36Q49 -20 28 -36Z" fill="#CBD5E1"/></g>` +
    sparkle(80, -80, 9, '#fff'),
  stethoscope: (p) =>
    heart(10, 20, 56, p.a) +
    `<path d="M-60 -90L-60 -40Q-60 0 -20 0Q20 0 20 -40L20 -90" stroke="#334155" stroke-width="7" fill="none" stroke-linecap="round"/>` +
    `<path d="M-20 0Q-20 60 40 70Q90 76 90 30" stroke="#334155" stroke-width="7" fill="none"/>` +
    `<circle cx="90" cy="24" r="16" fill="#94A3B8"/><circle cx="90" cy="24" r="8" fill="#E2E8F0"/>` +
    `<path d="M4 16L16 16L16 4L28 4L28 16L40 16L40 28L28 28L28 40L16 40L16 28L4 28Z" fill="#fff"/>`,
  ribbon: (p) =>
    `<path d="M0 -40C-30 -90 -70 -60 -40 -10L30 90L50 70L-14 -16C-30 -40 -14 -60 0 -40Z" fill="${p.a}"/>` +
    `<path d="M0 -40C30 -90 70 -60 40 -10L-30 90L-50 70L14 -16C30 -40 14 -60 0 -40Z" fill="${p.b}"/>` +
    leaf(-90, 60, 40, -60, '#4ADE80') +
    leaf(80, -40, 34, -20, '#4ADE80') +
    heart(70, 50, 14, p.c),
  dove: (p) =>
    `<path d="M-90 10C-60 -10 -20 0 0 10C30 -10 60 -10 90 -40C70 0 50 20 20 30C0 50 -40 50 -60 30C-70 20 -80 16 -90 10Z" fill="#fff"/>` +
    `<path d="M-20 10C-20 -40 10 -80 50 -90C40 -60 30 -20 10 10Z" fill="#F1F5F9"/>` +
    `<circle cx="-62" cy="12" r="3" fill="#111827"/><path d="M-90 10L-104 16L-90 18Z" fill="${p.c}"/>` +
    `<path d="M-100 20Q-120 30 -110 50" stroke="#16A34A" stroke-width="3" fill="none"/>` +
    leaf(-108, 30, 18, 120, '#22C55E') +
    leaf(-112, 44, 18, 160, '#22C55E') +
    sparkle(80, 50, 8, p.c),
  rainbow: () =>
    ['#EF4444', '#F97316', '#FACC15', '#22C55E', '#3B82F6', '#8B5CF6']
      .map(
        (c, i) =>
          `<path d="M${-100 + i * 14} 60A${100 - i * 14} ${100 - i * 14} 0 0 1 ${100 - i * 14} 60" stroke="${c}" stroke-width="14" fill="none"/>`,
      )
      .join('') +
    `<ellipse cx="-86" cy="62" rx="34" ry="18" fill="#fff"/><ellipse cx="86" cy="62" rx="34" ry="18" fill="#fff"/>` +
    heart(0, 20, 18, '#EF4444'),
  teacups: (p) =>
    [-46, 46]
      .map(
        (x, i) =>
          `<path d="M${x - 36} -6L${x + 36} -6Q${x + 34} 50 ${x} 54Q${x - 34} 50 ${x - 36} -6Z" fill="${i ? p.b : p.a}"/>` +
          `<path d="M${x + (i ? -36 : 36)} 6Q${x + (i ? -60 : 60)} 10 ${x + (i ? -34 : 34)} 34" stroke="${i ? p.b : p.a}" stroke-width="7" fill="none"/>` +
          `<ellipse cx="${x}" cy="60" rx="50" ry="8" fill="${p.c}"/>` +
          `<path d="M${x - 8} -20Q${x - 16} -40 ${x - 6} -56M${x + 8} -20Q${x} -40 ${x + 10} -56" stroke="#fff" stroke-width="3" fill="none" opacity="0.7"/>`,
      )
      .join('') + heart(0, -70, 16, p.c),
};

/** Which motif and colours each occasion uses. Unknown ids fall back to `celebrate`. */
export const GREETING_OCCASION_ART: Record<string, { motif: string; palette: GreetingPalette }> = {
  diwali: { motif: 'diya', palette: { a: '#7C2D12', b: '#C2410C', c: '#FBBF24', d: '#3B0A0A' } },
  holi: { motif: 'colours', palette: { a: '#DB2777', b: '#7C3AED', c: '#FACC15', d: '#4C1D95' } },
  'raksha-bandhan': {
    motif: 'rakhi',
    palette: { a: '#E11D48', b: '#F59E0B', c: '#FDE047', d: '#7F1D1D' },
  },
  janmashtami: {
    motif: 'flute',
    palette: { a: '#1E40AF', b: '#0EA5E9', c: '#FACC15', d: '#0C1E4F' },
  },
  'ganesh-chaturthi': {
    motif: 'modak',
    palette: { a: '#EA580C', b: '#DC2626', c: '#F59E0B', d: '#6B1D0E' },
  },
  navratri: {
    motif: 'dandiya',
    palette: { a: '#C026D3', b: '#F97316', c: '#FACC15', d: '#5B0E5E' },
  },
  'durga-puja': {
    motif: 'lotus',
    palette: { a: '#DC2626', b: '#F472B6', c: '#FBBF24', d: '#5F0F0F' },
  },
  dussehra: { motif: 'bow', palette: { a: '#B91C1C', b: '#F97316', c: '#FBBF24', d: '#4A0E0E' } },
  'bhai-dooj': {
    motif: 'thali',
    palette: { a: '#BE185D', b: '#C2410C', c: '#D4A017', d: '#500724' },
  },
  'chhath-puja': {
    motif: 'sunrise',
    palette: { a: '#EA580C', b: '#0E7490', c: '#FDBA74', d: '#3F1D0B' },
  },
  'makar-sankranti': {
    motif: 'kites',
    palette: { a: '#E11D48', b: '#2563EB', c: '#FACC15', d: '#0B2C6B' },
  },
  pongal: { motif: 'pot', palette: { a: '#B45309', b: '#65A30D', c: '#FBBF24', d: '#3D2A06' } },
  lohri: { motif: 'bonfire', palette: { a: '#B91C1C', b: '#F97316', c: '#FDE047', d: '#2A0F08' } },
  baisakhi: { motif: 'wheat', palette: { a: '#CA8A04', b: '#EA580C', c: '#FDE047', d: '#3D2C05' } },
  onam: { motif: 'pookalam', palette: { a: '#16A34A', b: '#F97316', c: '#FACC15', d: '#0B3B1E' } },
  'ugadi-gudi-padwa': {
    motif: 'toran',
    palette: { a: '#DB2777', b: '#16A34A', c: '#FACC15', d: '#0F3B24' },
  },
  'maha-shivratri': {
    motif: 'crescent',
    palette: { a: '#3730A3', b: '#0EA5E9', c: '#E0E7FF', d: '#0B1035' },
  },
  'ram-navami': {
    motif: 'bow',
    palette: { a: '#EA580C', b: '#FACC15', c: '#FDE68A', d: '#4A1D05' },
  },
  'guru-nanak-jayanti': {
    motif: 'diya',
    palette: { a: '#1E3A8A', b: '#EA580C', c: '#FBBF24', d: '#0B1A44' },
  },
  'eid-ul-fitr': {
    motif: 'crescentLantern',
    palette: { a: '#047857', b: '#10B981', c: '#FCD34D', d: '#022C22' },
  },
  'eid-al-adha': {
    motif: 'dome',
    palette: { a: '#0F766E', b: '#14B8A6', c: '#FCD34D', d: '#042F2E' },
  },
  'buddha-purnima': {
    motif: 'lotus',
    palette: { a: '#F59E0B', b: '#FDBA74', c: '#FEF3C7', d: '#4A2A06' },
  },
  'mahavir-jayanti': {
    motif: 'lotus',
    palette: { a: '#EAB308', b: '#FB7185', c: '#FEF9C3', d: '#3F2A06' },
  },
  navroz: { motif: 'tulips', palette: { a: '#DB2777', b: '#7C3AED', c: '#FBBF24', d: '#3B0A3F' } },
  'independence-day': {
    motif: 'tricolour',
    palette: { a: '#FF9933', b: '#138808', c: '#000080', d: '#0B1A44' },
  },
  'republic-day': {
    motif: 'tricolour',
    palette: { a: '#FF9933', b: '#138808', c: '#000080', d: '#0B1A44' },
  },
  'mid-autumn': {
    motif: 'mooncake',
    palette: { a: '#B91C1C', b: '#7C2D12', c: '#FDE68A', d: '#2A0A0A' },
  },
  chuseok: {
    motif: 'fullMoon',
    palette: { a: '#1E3A8A', b: '#3F6212', c: '#FEF3C7', d: '#0B1A3A' },
  },
  'rosh-hashanah': {
    motif: 'appleHoney',
    palette: { a: '#1D4ED8', b: '#B91C1C', c: '#F59E0B', d: '#0B1A44' },
  },
  passover: { motif: 'cup', palette: { a: '#1E40AF', b: '#60A5FA', c: '#D4A017', d: '#0B1A44' } },
  kwanzaa: { motif: 'kinara', palette: { a: '#15803D', b: '#B91C1C', c: '#FBBF24', d: '#0F1F12' } },
  'st-patricks-day': {
    motif: 'clover',
    palette: { a: '#15803D', b: '#22C55E', c: '#FACC15', d: '#052E16' },
  },
  carnival: { motif: 'mask', palette: { a: '#7C3AED', b: '#EC4899', c: '#FACC15', d: '#2E1065' } },
  halloween: {
    motif: 'pumpkin',
    palette: { a: '#EA580C', b: '#7C3AED', c: '#FDE047', d: '#1C0B2E' },
  },
  'day-of-the-dead': {
    motif: 'marigolds',
    palette: { a: '#C026D3', b: '#EA580C', c: '#FDE047', d: '#3B0A3F' },
  },
  songkran: {
    motif: 'waterSplash',
    palette: { a: '#0EA5E9', b: '#EC4899', c: '#FDE047', d: '#0C2A4A' },
  },
  'loy-krathong': {
    motif: 'lotus',
    palette: { a: '#F472B6', b: '#22C55E', c: '#FDE68A', d: '#0B1A3A' },
  },
  'earth-day': {
    motif: 'globe',
    palette: { a: '#0EA5E9', b: '#16A34A', c: '#F43F5E', d: '#0B2A3A' },
  },
  'environment-day': {
    motif: 'sapling',
    palette: { a: '#16A34A', b: '#65A30D', c: '#FACC15', d: '#052E16' },
  },
  'yoga-day': {
    motif: 'yogaPose',
    palette: { a: '#EA580C', b: '#F59E0B', c: '#FDE68A', d: '#3A1606' },
  },
  'labour-day': {
    motif: 'gear',
    palette: { a: '#B91C1C', b: '#EA580C', c: '#FBBF24', d: '#2A0A0A' },
  },
  'childrens-day': {
    motif: 'balloons',
    palette: { a: '#F43F5E', b: '#22C55E', c: '#38BDF8', d: '#1E1B4B' },
  },
  'nurses-day': {
    motif: 'stethoscope',
    palette: { a: '#F472B6', b: '#38BDF8', c: '#FDE68A', d: '#0B2540' },
  },
  'doctors-day': {
    motif: 'stethoscope',
    palette: { a: '#EF4444', b: '#0EA5E9', c: '#FDE68A', d: '#0B2540' },
  },
  'mental-health-day': {
    motif: 'ribbon',
    palette: { a: '#22C55E', b: '#16A34A', c: '#FDE68A', d: '#052E16' },
  },
  'peace-day': {
    motif: 'dove',
    palette: { a: '#0EA5E9', b: '#38BDF8', c: '#FBBF24', d: '#0B2540' },
  },
  'kindness-day': {
    motif: 'envelope',
    palette: { a: '#F59E0B', b: '#F472B6', c: '#FDE047', d: '#3A1606' },
  },
  'mens-day': { motif: 'tie', palette: { a: '#2563EB', b: '#0F172A', c: '#FBBF24', d: '#0B1A3A' } },
  'grandparents-day': {
    motif: 'teacups',
    palette: { a: '#0D9488', b: '#E11D48', c: '#FBBF24', d: '#042F2E' },
  },
  pride: { motif: 'rainbow', palette: { a: '#8B5CF6', b: '#EC4899', c: '#FACC15', d: '#1E1B4B' } },
  'national-day': {
    motif: 'fireworks',
    palette: { a: '#DC2626', b: '#2563EB', c: '#FACC15', d: '#0B1A3A' },
  },
  'new-year': {
    motif: 'fireworks',
    palette: { a: '#7C3AED', b: '#EC4899', c: '#FACC15', d: '#1E1B4B' },
  },
  christmas: { motif: 'tree', palette: { a: '#B91C1C', b: '#15803D', c: '#FACC15', d: '#3B0A0A' } },
  'lunar-new-year': {
    motif: 'lanterns',
    palette: { a: '#DC2626', b: '#991B1B', c: '#FBBF24', d: '#450A0A' },
  },
  ramadan: {
    motif: 'crescentLantern',
    palette: { a: '#4338CA', b: '#6366F1', c: '#FCD34D', d: '#1E1B4B' },
  },
  easter: { motif: 'eggs', palette: { a: '#A78BFA', b: '#F472B6', c: '#FCD34D', d: '#3B2A63' } },
  hanukkah: {
    motif: 'menorah',
    palette: { a: '#1D4ED8', b: '#60A5FA', c: '#FCD34D', d: '#0B1F4F' },
  },
  thanksgiving: {
    motif: 'leaves',
    palette: { a: '#C2410C', b: '#92400E', c: '#FBBF24', d: '#3A1606' },
  },
  'valentines-day': {
    motif: 'hearts',
    palette: { a: '#E11D48', b: '#F472B6', c: '#FDA4AF', d: '#4C0519' },
  },
  'womens-day': {
    motif: 'bouquet',
    palette: { a: '#9333EA', b: '#EC4899', c: '#FBBF24', d: '#3B0764' },
  },
  'mothers-day': {
    motif: 'tulips',
    palette: { a: '#EC4899', b: '#F43F5E', c: '#FBCFE8', d: '#500724' },
  },
  'fathers-day': {
    motif: 'tie',
    palette: { a: '#1D4ED8', b: '#0F172A', c: '#FBBF24', d: '#0B1A3A' },
  },
  'friendship-day': {
    motif: 'twoHearts',
    palette: { a: '#F97316', b: '#EC4899', c: '#FDE047', d: '#4A1206' },
  },
  'teachers-day': {
    motif: 'books',
    palette: { a: '#1D4ED8', b: '#0D9488', c: '#F59E0B', d: '#0B1F4F' },
  },
  birthday: { motif: 'cake', palette: { a: '#EC4899', b: '#8B5CF6', c: '#FBBF24', d: '#3B0764' } },
  wedding: { motif: 'rings', palette: { a: '#BE123C', b: '#F9A8D4', c: '#D4A017', d: '#4C0519' } },
  engagement: {
    motif: 'rings',
    palette: { a: '#DB2777', b: '#F9A8D4', c: '#E6B84D', d: '#500724' },
  },
  anniversary: {
    motif: 'twoHearts',
    palette: { a: '#E11D48', b: '#BE185D', c: '#FBBF24', d: '#4C0519' },
  },
  'new-baby': {
    motif: 'babyMoon',
    palette: { a: '#60A5FA', b: '#F9A8D4', c: '#FDE68A', d: '#1E3A5F' },
  },
  graduation: { motif: 'cap', palette: { a: '#1D4ED8', b: '#0F172A', c: '#FBBF24', d: '#0B1A3A' } },
  housewarming: {
    motif: 'house',
    palette: { a: '#DC2626', b: '#0F766E', c: '#FBBF24', d: '#3B0A0A' },
  },
  'good-luck': {
    motif: 'clover',
    palette: { a: '#16A34A', b: '#22C55E', c: '#FACC15', d: '#052E16' },
  },
  'work-anniversary': {
    motif: 'medal',
    palette: { a: '#1D4ED8', b: '#DC2626', c: '#F59E0B', d: '#0B1A44' },
  },
  promotion: { motif: 'rise', palette: { a: '#4F46E5', b: '#0EA5E9', c: '#FBBF24', d: '#1E1B4B' } },
  welcome: {
    motif: 'balloons',
    palette: { a: '#0EA5E9', b: '#22C55E', c: '#F59E0B', d: '#0C2A4A' },
  },
  farewell: { motif: 'plane', palette: { a: '#0284C7', b: '#38BDF8', c: '#FBBF24', d: '#0B2540' } },
  congratulations: {
    motif: 'popper',
    palette: { a: '#7C3AED', b: '#EC4899', c: '#FACC15', d: '#2E1065' },
  },
  'thank-you': {
    motif: 'bouquet',
    palette: { a: '#F43F5E', b: '#F59E0B', c: '#FDE68A', d: '#4C0519' },
  },
  'great-work': {
    motif: 'trophy',
    palette: { a: '#0F766E', b: '#14B8A6', c: '#F59E0B', d: '#042F2E' },
  },
  retirement: {
    motif: 'sunrise',
    palette: { a: '#EA580C', b: '#0369A1', c: '#FCD34D', d: '#3A1606' },
  },
  launch: { motif: 'rocket', palette: { a: '#E11D48', b: '#2563EB', c: '#FACC15', d: '#0B1A44' } },
  'get-well': {
    motif: 'flowerVase',
    palette: { a: '#F472B6', b: '#38BDF8', c: '#FDE68A', d: '#0B2540' },
  },
  condolence: {
    motif: 'candle',
    palette: { a: '#64748B', b: '#94A3B8', c: '#E2E8F0', d: '#1E293B' },
  },
  'thinking-of-you': {
    motif: 'envelope',
    palette: { a: '#F43F5E', b: '#A78BFA', c: '#FBBF24', d: '#3B0764' },
  },
};

export const DEFAULT_GREETING_ART = {
  motif: 'popper',
  palette: { a: '#7C3AED', b: '#EC4899', c: '#FACC15', d: '#2E1065' },
};
