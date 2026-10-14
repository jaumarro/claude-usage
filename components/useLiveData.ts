'use client';

import { useEffect, useRef, useState } from 'react';

export type LiveState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

/**
 * Fetches `url`, then refetches whenever `tick` advances.
 *
 * A poll never returns the panel to `loading`: it resolves straight into `ready` with the
 * new data, so the chart keeps its mounted instance and swaps values in place instead of
 * unmounting, replaying its entry animation, and flashing empty every interval. Only a
 * genuine url change (the user moving a filter) shows the loading state.
 */
export function useLiveData<T>(
  url: string,
  tick: number,
  parse: (payload: unknown) => T,
): LiveState<T> {
  const [state, setState] = useState<LiveState<T>>({ status: 'loading' });
  const lastUrl = useRef<string | null>(null);
  const parseRef = useRef(parse);
  parseRef.current = parse;

  useEffect(() => {
    let live = true;
    const isPoll = lastUrl.current === url;
    lastUrl.current = url;

    if (!isPoll) {
      setState({ status: 'loading' });
    }

    fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`${url} responded ${response.status}`);
        }
        return (await response.json()) as unknown;
      })
      .then((payload) => {
        if (live) {
          setState({ status: 'ready', data: parseRef.current(payload) });
        }
      })
      .catch((error: unknown) => {
        // A failed poll keeps the last good data on screen rather than blanking the panel.
        if (live && !isPoll) {
          setState({ status: 'error', message: String(error) });
        }
      });

    return () => {
      live = false;
    };
  }, [url, tick]);

  return state;
}

/** Every usage route answers `{ columns, rows }`; this validates the rows and nothing else. */
export function rowsParser<T>(isRow: (value: unknown) => value is T): (payload: unknown) => T[] {
  return (payload) => {
    const rows = typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'rows') : null;
    if (!Array.isArray(rows) || !rows.every(isRow)) {
      throw new Error('route returned an unexpected shape');
    }
    return rows;
  };
}
