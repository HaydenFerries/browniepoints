import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { durationLabel } from '../lib/tasks';

// Times the points snap to (hours). Spaced evenly across so both "a few
// hours" and "a few weeks" are easy to hit.
const STEPS = [0, 1, 2, 3, 6, 12, 24, 48, 72, 96, 120, 168, 240, 336, 504, 720];
const TICKS: Record<number, string> = { 0: 'Now', 6: '6h', 24: '1d', 72: '3d', 168: '1w', 336: '2w', 720: '30d' };

// Plot area inside the viewBox. The line runs between T (full) and B (stale);
// the time axis sits a little lower (AX) so the points never cover its labels.
const W = 320;
const L = 48;
const R = 304;
const T = 20;
const B = 124;
const AX = B + 18;
const H = AX + 36;

const nearestStep = (hours: number) =>
  STEPS.reduce((best, h, i) => (Math.abs(h - hours) < Math.abs(STEPS[best] - hours) ? i : best), 0);
const xOf = (i: number) => L + (i / (STEPS.length - 1)) * (R - L);

export interface DecayTiming {
  /** Hours it stays at full price. */
  grace: number;
  /** Hours until it's fully stale. */
  stale: number;
}

/**
 * Time across, brownies up (stale price → full price). Drag 🔥 to choose how
 * long it stays at full price and ❄️ to choose when it reaches the stale
 * price. Arrow keys work too.
 */
export function DecayGraph({
  price,
  stalePrice,
  value,
  onChange,
}: {
  price: number;
  stalePrice: number;
  value: DecayTiming;
  onChange: (v: DecayTiming) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<'cool' | 'stale' | null>(null);
  const gi = nearestStep(value.grace);
  const si = Math.max(gi + 1, nearestStep(value.stale));

  const set = (next: { gi?: number; si?: number }) => {
    const g = Math.max(0, Math.min(next.gi ?? gi, (next.si ?? si) - 1));
    const s = Math.min(STEPS.length - 1, Math.max(next.si ?? si, g + 1));
    onChange({ grace: STEPS[g], stale: STEPS[s] });
  };

  const stepFrom = (e: PointerEvent) => {
    const box = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    return Math.round(((Math.min(R, Math.max(L, x)) - L) / (R - L)) * (STEPS.length - 1));
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const idx = stepFrom(e);
    if (dragging === 'cool') set({ gi: Math.min(idx, STEPS.length - 2) });
    else set({ si: Math.max(1, idx) });
  };
  const grab = (which: 'cool' | 'stale') => (e: PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragging(which);
  };
  const keys = (which: 'cool' | 'stale') => (e: KeyboardEvent) => {
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 }[e.key as 'ArrowLeft'];
    if (d === undefined) return;
    e.preventDefault();
    if (which === 'cool') set({ gi: Math.min(STEPS.length - 2, gi + d) });
    else set({ si: Math.max(1, si + d) });
  };

  const cx = xOf(gi);
  const sx = xOf(si);
  const line = `M${L},${T} L${cx},${T} L${sx},${B} L${R},${B}`;
  const area = `${line} L${R},${AX} L${L},${AX} Z`;
  const fullFor = gi === 0 ? 'Cools straight away' : `Full price for ${durationLabel(STEPS[gi])}`;

  return (
    <div className="decay-graph">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        onPointerMove={onMove}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
        className={dragging ? 'is-dragging' : ''}
        aria-label="How the price drops over time"
      >
        <defs>
          <linearGradient id="decay-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#f0b45e" stopOpacity="0.45" />
            <stop offset="1" stopColor="#6a3518" stopOpacity="0.08" />
          </linearGradient>
        </defs>

        {/* time grid + labels (across) */}
        {STEPS.map((h, i) =>
          TICKS[h] ? (
            <g key={h}>
              <line x1={xOf(i)} x2={xOf(i)} y1={T} y2={AX} className="dg-grid" />
              <text x={xOf(i)} y={AX + 16} className="dg-tick" textAnchor="middle">
                {TICKS[h]}
              </text>
            </g>
          ) : null,
        )}
        <line x1={L} x2={R} y1={AX} y2={AX} className="dg-axis" />
        <line x1={L} x2={L} y1={T} y2={AX} className="dg-axis" />
        <text x={(L + R) / 2} y={H - 4} className="dg-axis-label" textAnchor="middle">
          time →
        </text>

        {/* brownie labels (up): full price at the top, stale price at the bottom */}
        <text x={L - 16} y={T + 4} className="dg-tick dg-tick-on" textAnchor="end">
          {price}
        </text>
        <text x={L - 16} y={B + 4} className="dg-tick dg-tick-stale" textAnchor="end">
          {stalePrice}
        </text>

        <path d={area} fill="url(#decay-fill)" />
        <path d={line} className="dg-line" />
        {/* guides from each point to the time axis */}
        <line x1={cx} x2={cx} y1={T + 12} y2={AX} className="dg-guide" />
        <line x1={sx} x2={sx} y1={B + 12} y2={AX} className="dg-guide" />

        <g
          className="dg-handle"
          tabIndex={0}
          role="slider"
          aria-label="Stays at full price for"
          aria-valuetext={gi === 0 ? 'starts cooling straight away' : durationLabel(STEPS[gi])}
          aria-valuemin={0}
          aria-valuemax={STEPS.length - 2}
          aria-valuenow={gi}
          onPointerDown={grab('cool')}
          onKeyDown={keys('cool')}
        >
          <circle cx={cx} cy={T} r={20} className="dg-hit" />
          <circle cx={cx} cy={T} r={11} className="dg-dot dg-dot-cool" />
          <text x={cx} y={T + 4} textAnchor="middle" className="dg-emoji">
            🔥
          </text>
        </g>

        <g
          className="dg-handle"
          tabIndex={0}
          role="slider"
          aria-label="Goes stale after"
          aria-valuetext={durationLabel(STEPS[si])}
          aria-valuemin={1}
          aria-valuemax={STEPS.length - 1}
          aria-valuenow={si}
          onPointerDown={grab('stale')}
          onKeyDown={keys('stale')}
        >
          <circle cx={sx} cy={B} r={20} className="dg-hit" />
          <circle cx={sx} cy={B} r={11} className="dg-dot dg-dot-stale" />
          <text x={sx} y={B + 4} textAnchor="middle" className="dg-emoji">
            ❄️
          </text>
        </g>
      </svg>

      <div className="dg-readouts">
        <span className="dg-readout dg-readout-cool">
          <b>🔥</b> {fullFor}
        </span>
        <span className="dg-readout dg-readout-stale">
          <b>❄️</b> {stalePrice} after {durationLabel(STEPS[si])}
        </span>
      </div>
      <p className="small muted decay-summary">
        {gi > 0
          ? `Worth ${price} for ${durationLabel(STEPS[gi])}, then slides to ${stalePrice} over the next ${durationLabel(STEPS[si] - STEPS[gi])}.`
          : `Starts at ${price} and slides to ${stalePrice} over ${durationLabel(STEPS[si])}.`}{' '}
        Warm it up any time to make it fresh again.
      </p>
      <p className="small muted decay-hint">Drag 🔥 and ❄️ left or right.</p>
    </div>
  );
}
