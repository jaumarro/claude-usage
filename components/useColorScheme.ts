'use client';

import { useEffect, useState } from 'react';
import type { ColorScheme } from '@/lib/charts/theme';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

/** Follows the OS appearance, live. Dark, the house default, until the browser answers on mount. */
export function useColorScheme(): ColorScheme {
  const [scheme, setScheme] = useState<ColorScheme>('dark');

  useEffect(() => {
    const query = window.matchMedia(LIGHT_QUERY);
    const update = (): void => {
      setScheme(query.matches ? 'light' : 'dark');
    };
    update();
    query.addEventListener('change', update);
    return () => {
      query.removeEventListener('change', update);
    };
  }, []);

  return scheme;
}
