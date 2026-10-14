import type { ReactNode } from 'react';

export function Shell({
  meta,
  controls,
  children,
}: {
  meta?: string;
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <header className="masthead">
        <span className="prompt">~/.claude $</span>
        <h1>usage</h1>
        {meta === undefined ? null : <span className="meta">{meta}</span>}
        {controls === undefined ? null : <div className="controls">{controls}</div>}
      </header>
      <div className="grid">{children}</div>
    </div>
  );
}

type PanelProps = {
  title: string;
  /** Grid columns out of 12. Half-width panels sit two to a row on wide screens. */
  span?: 6 | 12;
  /** Sits at the right of the header, e.g. a chart view toggle. */
  controls?: ReactNode;
  children: ReactNode;
};

export function Panel({ title, span = 12, controls, children }: PanelProps) {
  const className = span === 6 ? 'panel half' : 'panel';

  return (
    <section className={className}>
      <header>
        <span className="dot" />
        <span>{title}</span>
        {controls}
      </header>
      <div className="body">{children}</div>
    </section>
  );
}

/** Holds the chart's place while its data loads, so the panel keeps its height. */
export function Loading() {
  return (
    <div className="loading" role="status" aria-label="loading">
      <span className="spinner" />
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
  hero = false,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'accent' | 'warn';
  /** One figure per panel may claim the hero size. More than one and nothing leads. */
  hero?: boolean;
  hint?: string;
}) {
  const classes = ['stat'];
  if (hero) {
    classes.push('hero');
  }
  const valueClass = tone === undefined ? 'v' : `v ${tone}`;

  return (
    <div className={classes.join(' ')}>
      <div className="k">{label}</div>
      <div className={valueClass}>{value}</div>
      {hint === undefined ? null : <div className="hint">{hint}</div>}
    </div>
  );
}
