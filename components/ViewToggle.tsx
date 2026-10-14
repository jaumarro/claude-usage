'use client';

import { useEffect, useState } from 'react';

const STORAGE_PREFIX = 'claude-usage.view.';

/**
 * A panel's chart view, remembered per panel. Read on mount rather than in the initializer for
 * the reason the filters are: the initializer also runs during SSR, and a differing first client
 * render is a hydration mismatch. Every storage access is guarded, since a browser blocking site
 * data throws on the property itself.
 */
export function usePanelView<T extends string>(
  panel: string,
  views: readonly T[],
  fallback: T,
): [T, (view: T) => void] {
  const [view, setView] = useState<T>(fallback);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${panel}`);
      const known = views.find((candidate) => candidate === stored);
      if (known !== undefined) {
        setView(known);
      }
    } catch {
      // A remembered view is a convenience; losing it must never break the panel.
    }
  }, [panel, views]);

  const choose = (next: T): void => {
    setView(next);
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${panel}`, next);
    } catch {
      // As above.
    }
  };

  // A view the panel cannot draw right now, such as bars at minute buckets, gives way to the
  // fallback without being forgotten: it comes back once the views offer it again.
  const shown = views.includes(view) ? view : fallback;
  return [shown, choose];
}

export function ViewToggle<T extends string>({
  views,
  labels,
  value,
  onChange,
}: {
  views: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (view: T) => void;
}) {
  return (
    <div className="views" role="group" aria-label="chart view">
      {views.map((view) => {
        const className = view === value ? 'seg view on' : 'seg view';
        return (
          <button
            key={view}
            type="button"
            className={className}
            aria-pressed={view === value}
            onClick={() => {
              onChange(view);
            }}
          >
            {labels[view]}
          </button>
        );
      })}
    </div>
  );
}
