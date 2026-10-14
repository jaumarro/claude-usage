'use client';

const SIZE = 18;
const R = 7;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * A ring that fills over one refresh interval, the way Metabase shows time to next poll.
 * `cycle` changes on every tick so the animation restarts from empty rather than easing
 * back, and the whole element is aria-hidden because the adjacent text carries the state.
 */
export function RefreshDial({ intervalMs, cycle }: { intervalMs: number; cycle: number }) {
  return (
    <svg
      key={cycle}
      className="dial"
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      aria-hidden="true"
    >
      <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--chrome)" strokeWidth="2" />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={R}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        style={{
          animation: `dial-fill ${intervalMs}ms linear forwards`,
        }}
      />
    </svg>
  );
}
