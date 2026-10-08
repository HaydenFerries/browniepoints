// A glossy ganache edge that drips down from the header.
const DRIPS = [
  { x: 14, r: 5, l: 20 },
  { x: 52, r: 4, l: 11 },
  { x: 92, r: 6.5, l: 34 },
  { x: 136, r: 4.5, l: 16 },
  { x: 178, r: 5.5, l: 25 },
  { x: 222, r: 3.5, l: 10 },
  { x: 258, r: 6, l: 30 },
  { x: 304, r: 4.5, l: 15 },
  { x: 346, r: 5.5, l: 23 },
  { x: 386, r: 3.5, l: 9 },
];
const BASE = 8;

function path() {
  let d = `M0,0 H400 V${BASE}`;
  for (const { x, r, l } of [...DRIPS].sort((a, b) => b.x - a.x)) {
    const bottom = BASE + l;
    d += ` L${x + r + 9},${BASE}`;
    d += ` C${x + r + 2},${BASE} ${x + r - 0.5},${BASE + 3} ${x + r - 0.5},${BASE + 8}`;
    d += ` L${x + r},${bottom - r}`;
    d += ` A${r},${r} 0 0 1 ${x - r},${bottom - r}`;
    d += ` L${x - r + 0.5},${BASE + 8}`;
    d += ` C${x - r + 0.5},${BASE + 3} ${x - r - 2},${BASE} ${x - r - 9},${BASE}`;
  }
  return d + ` L0,${BASE} Z`;
}
const D = path();

export function Drip({ className = '' }: { className?: string }) {
  return (
    <svg className={`drip ${className}`} viewBox="0 0 400 46" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="drip-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#3f1f0f" />
          <stop offset=".5" stopColor="#38190b" />
          <stop offset="1" stopColor="#2a1207" />
        </linearGradient>
      </defs>
      <path d={D} fill="url(#drip-fill)" />
      {DRIPS.map(({ x, r, l }) => (
        <ellipse key={x} cx={x - r * 0.35} cy={BASE + l - r * 1.1} rx={r * 0.28} ry={r * 0.5} fill="#ffe2c4" opacity=".28" />
      ))}
      <path d={`M0,${BASE - 2.5} H400`} stroke="#ffd9b0" strokeOpacity=".08" strokeWidth="1.2" />
    </svg>
  );
}
