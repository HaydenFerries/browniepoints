import { useEffect, useId, useRef } from 'react';
import { BROWNIE_LARGE } from './Brownie';
import { seeded } from '../lib/util';

// Brownies stack up from the bottom of a glass jar; the top layers taper into
// a mound. Each slot has a fixed position/rotation so the pile never jumps.
const ROW_COUNTS = [4, 3, 4, 3, 4, 3];
export const JAR_MAX = ROW_COUNTS.reduce((a, b) => a + b, 0);
const PIECE_W = 58;
const PIECE_H = PIECE_W * (462 / 512);

const SLOTS = (() => {
  const rnd = seeded(20251009);
  const slots: { x: number; y: number; rot: number; flip: boolean; scale: number }[] = [];
  ROW_COUNTS.forEach((count, r) => {
    const y = 204 - r * 25;
    const left = count === 3 ? 62 : 54;
    const right = count === 3 ? 138 : 146;
    const xs = Array.from({ length: count }, (_, c) => (count === 1 ? 100 : left + (c * (right - left)) / (count - 1)));
    const shift = r % 2 ? 4 : -4;
    // fill each row from the middle outwards so partial rows look like a heap
    const order = [...xs.keys()].sort((a, b) => Math.abs(a - (count - 1) / 2) - Math.abs(b - (count - 1) / 2));
    for (const c of order) {
      slots.push({
        x: xs[c] + shift + (rnd() - 0.5) * 6,
        y: y + (rnd() - 0.5) * 5,
        rot: (rnd() - 0.5) * 38,
        flip: rnd() > 0.5,
        scale: 0.92 + rnd() * 0.16,
      });
    }
  });
  return slots;
})();

/** How many brownies to draw for a balance: 1:1 for small amounts, then it
 *  keeps growing more slowly so big balances still look different. */
export function piecesFor(balance: number) {
  if (balance <= 0) return 0;
  if (balance <= 6) return balance;
  return Math.min(JAR_MAX, 6 + Math.round(((JAR_MAX - 6) * (balance - 6)) / (balance - 6 + 90)));
}

const ACCENTS = {
  caramel: { cloth: '#c98a3e', ribbon: '#6e3510', knot: '#8a4518' },
  berry: { cloth: '#c4485f', ribbon: '#68192d', knot: '#86233b' },
};

export function Jar({ balance, accent = 'caramel', className = '' }: { balance: number; accent?: keyof typeof ACCENTS; className?: string }) {
  const id = useId().replace(/[:«»]/g, '');
  const n = piecesFor(balance);
  const prev = useRef(0);
  const base = Math.min(prev.current, n);
  useEffect(() => {
    prev.current = n;
  }, [n]);
  const colors = ACCENTS[accent];

  const body = 'M60,62 C60,72 28,74 28,100 L28,212 Q28,236 52,236 L148,236 Q172,236 172,212 L172,100 C172,74 140,72 140,62 Z';
  const inner = 'M64,60 C64,76 33,79 33,102 L33,210 Q33,231 54,231 L146,231 Q167,231 167,210 L167,102 C167,79 136,76 136,60 Z';

  return (
    <svg viewBox="0 0 200 250" className={`jar ${className}`} role="img" aria-label={`Jar with ${balance} brownies`}>
      <defs>
        <clipPath id={`in-${id}`}>
          <path d={inner} />
        </clipPath>
        <linearGradient id={`glass-${id}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff3e6" stopOpacity=".26" />
          <stop offset=".13" stopColor="#fff3e6" stopOpacity=".07" />
          <stop offset=".5" stopColor="#fff3e6" stopOpacity=".02" />
          <stop offset=".86" stopColor="#fff3e6" stopOpacity=".06" />
          <stop offset="1" stopColor="#fff3e6" stopOpacity=".2" />
        </linearGradient>
        <linearGradient id={`back-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffe9d2" stopOpacity=".05" />
          <stop offset="1" stopColor="#ffe9d2" stopOpacity=".1" />
        </linearGradient>
        <linearGradient id={`depth-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset=".55" stopColor="#120602" stopOpacity="0" />
          <stop offset="1" stopColor="#120602" stopOpacity=".3" />
        </linearGradient>
        <pattern id={`ging-${id}`} width="9" height="9" patternUnits="userSpaceOnUse">
          <rect width="9" height="9" fill={colors.cloth} />
          <rect width="9" height="4.5" fill="#fff6ea" fillOpacity=".34" />
          <rect width="4.5" height="9" fill="#fff6ea" fillOpacity=".34" />
        </pattern>
        <linearGradient id={`clothShade-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".18" />
          <stop offset=".55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".28" />
        </linearGradient>
        <filter id={`ps-${id}`} x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="2.2" stdDeviation="1.8" floodColor="#0d0402" floodOpacity=".6" />
        </filter>
        <filter id={`blur-${id}`}>
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {/* floor shadow */}
      <ellipse cx="100" cy="240" rx="74" ry="7" fill="#000" opacity=".5" filter={`url(#blur-${id})`} />

      {/* back of the glass */}
      <path d={body} fill={`url(#back-${id})`} />

      {/* the brownies */}
      <g clipPath={`url(#in-${id})`}>
        {n === 0 && (
          <g fill="#4a2414" opacity=".9">
            <circle cx="70" cy="226" r="2.4" />
            <circle cx="84" cy="228" r="1.6" />
            <circle cx="121" cy="227" r="2" />
            <circle cx="133" cy="225" r="1.3" />
            <circle cx="102" cy="229" r="1.4" />
          </g>
        )}
        {SLOTS.slice(0, n).map((s, i) => (
          <g
            key={i}
            className="jar-piece"
            style={{
              animationDelay: `${i >= base ? (i - base) * 55 : 0}ms`,
              ['--drop' as string]: `${-(s.y + 30)}px`,
            }}
          >
            <image
              href={BROWNIE_LARGE}
              x={-PIECE_W / 2}
              y={-PIECE_H / 2}
              width={PIECE_W}
              height={PIECE_H}
              filter={`url(#ps-${id})`}
              transform={`translate(${s.x} ${s.y}) rotate(${s.rot}) scale(${s.flip ? -s.scale : s.scale} ${s.scale})`}
            />
          </g>
        ))}
        <rect x="0" y="60" width="200" height="180" fill={`url(#depth-${id})`} />
      </g>

      {/* front of the glass */}
      <path d={body} fill={`url(#glass-${id})`} stroke="#ffeedd" strokeOpacity=".4" strokeWidth="2" />
      <path d="M41,112 C38,146 38,184 43,216" stroke="#fff" strokeOpacity=".32" strokeWidth="6" strokeLinecap="round" fill="none" />
      <path d="M41,96 C42,90 45,86 49,83" stroke="#fff" strokeOpacity=".28" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <path d="M160,128 C162,150 162,172 160,190" stroke="#fff" strokeOpacity=".14" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <path d="M56,230 Q100,236 144,230" stroke="#fff" strokeOpacity=".12" strokeWidth="2" strokeLinecap="round" fill="none" />

      {/* gingham cloth lid + ribbon */}
      <g>
        <path
          d="M48,48 C50,35 76,29 100,29 C124,29 150,35 152,48 L160,66 Q153,72 146,67 Q139,75 131,68 Q123,76 115,69 Q107,77 100,69 Q93,77 85,69 Q77,76 69,68 Q61,75 54,67 Q47,72 40,66 Z"
          fill={`url(#ging-${id})`}
        />
        <path
          d="M48,48 C50,35 76,29 100,29 C124,29 150,35 152,48 L160,66 Q153,72 146,67 Q139,75 131,68 Q123,76 115,69 Q107,77 100,69 Q93,77 85,69 Q77,76 69,68 Q61,75 54,67 Q47,72 40,66 Z"
          fill={`url(#clothShade-${id})`}
        />
        <path d="M51,51 Q100,58 149,51 L150,57 Q100,64 50,57 Z" fill={colors.ribbon} />
        <path d="M100,55 C90,42 76,44 80,53 C83,59 93,58 100,55 Z" fill={colors.ribbon} />
        <path d="M100,55 C110,42 124,44 120,53 C117,59 107,58 100,55 Z" fill={colors.ribbon} />
        <path d="M98,57 L91,73 L95,71 L97,75 L101,58 Z" fill={colors.ribbon} />
        <path d="M102,57 L109,73 L105,71 L103,75 L99,58 Z" fill={colors.ribbon} />
        <ellipse cx="100" cy="55.5" rx="4.2" ry="3.6" fill={colors.knot} />
        <path d="M84,49 C86,47 90,47 92,49" stroke="#fff" strokeOpacity=".3" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <path d="M108,49 C110,47 114,47 116,49" stroke="#fff" strokeOpacity=".3" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}
