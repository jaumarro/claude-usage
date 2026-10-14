import { config, scale, style, styles } from '@graphysdk/react';
import type { GraphProvider } from '@graphysdk/react';
import type { ComponentProps } from 'react';
import {
  BARS_LAYER,
  DONUT_LAYER,
  OVERLAP_LAYER,
  SESSIONS_LAYER,
  SESSION_TOTALS_LAYER,
} from '@/lib/charts/seriesViews';

type ProviderProps = ComponentProps<typeof GraphProvider>;

export type ColorScheme = 'light' | 'dark';

type Tokens = {
  surface: string;
  chrome: string;
  border: string;
  text: string;
  dim: string;
  /** Pure black or white, the one ink no series hue comes near. */
  ink: string;
};

/** The chart's share of the stylesheet's tokens, per scheme. Kept in step with `globals.css`. */
const TERM: Record<ColorScheme, Tokens> = {
  dark: {
    surface: '#11151A',
    chrome: '#232B34',
    border: '#1F262E',
    text: '#D6DEE8',
    dim: '#7D8794',
    ink: '#FFFFFF',
  },
  light: {
    surface: '#FCFCFB',
    chrome: '#CCD3DA',
    border: '#DFE3E8',
    text: '#1C2127',
    dim: '#5F6873',
    ink: '#000000',
  },
};

export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';

export const PALETTE_ID = 'terminal';

// Tailwind's 400 steps on the dark surface and its 600 steps on the light one, ordered so that
// neighbours stay apart under protan and deutan vision too. Against #FCFCFB validate_palette.js
// passes every check; against #11151A every check but its lightness band, which the 400s sit
// above for brightness. Eight slots, so eight models never share one. Re-run the validator
// before changing a value.
const SERIES = [
  { id: 'rose', hex: '#fb7185' },
  { id: 'sky', hex: '#38bdf8' },
  { id: 'orange', hex: '#fb923c' },
  { id: 'emerald', hex: '#34d399' },
  { id: 'violet', hex: '#a78bfa' },
  { id: 'amber', hex: '#fbbf24' },
  { id: 'fuchsia', hex: '#e879f9' },
  { id: 'lime', hex: '#a3e635' },
];

const SERIES_LIGHT = [
  { id: 'rose', hex: '#e11d48' },
  { id: 'sky', hex: '#0284c7' },
  { id: 'orange', hex: '#ea580c' },
  { id: 'emerald', hex: '#059669' },
  { id: 'violet', hex: '#7c3aed' },
  { id: 'amber', hex: '#d97706' },
  { id: 'fuchsia', hex: '#c026d3' },
  { id: 'lime', hex: '#65a30d' },
];

/** Hue ids in palette order: the nth group a chart meets takes the nth id, cycling. */
export const SERIES_IDS = SERIES.map((entry) => entry.id);

/** The palette's hues in order, for a chart that hands them out itself. */
export function seriesHues(scheme: ColorScheme): string[] {
  return (scheme === 'light' ? SERIES_LIGHT : SERIES).map((entry) => entry.hex);
}

export const terminalPalette = scale.color.palette({
  palette: { type: 'custom', id: PALETTE_ID },
});

const label = {
  fontFamily: MONO,
  fontSize: 10,
  fontWeight: 500,
  lineHeight: 1.5,
};

// The engine's own dotted and dashed presets for these targets, in stroke widths. The react entry
// does not re-export its DASH_PRESETS table.
const DOTTED_GRID = [1, 3];
const DASHED_RULE = [2, 3];

/** One faint tint under every band and slice, so the lines carry the colour. */
const FILL_ALPHA = 0.12;

/** `hex` laid over `surface` at `alpha`, as one opaque colour. */
function tint(hex: string, surface: string, alpha: number): string {
  const channel = (color: string, index: number) => parseInt(color.slice(1 + index * 2, 3 + index * 2), 16);
  const mixed = [0, 1, 2].map((index) => {
    const value = Math.round(channel(surface, index) + (channel(hex, index) - channel(surface, index)) * alpha);
    return value.toString(16).padStart(2, '0');
  });
  return `#${mixed.join('')}`;
}

/** The faint fill bands and slices take, mixed in advance for a bar, whose alpha would fade its edge too. */
export function lightFill(scheme: ColorScheme, hex: string): string {
  return tint(hex, TERM[scheme].surface, FILL_ALPHA);
}

function themeFor(scheme: ColorScheme) {
  const term = TERM[scheme];
  const series = scheme === 'light' ? SERIES_LIGHT : SERIES;
  const stylesheet = styles({
    defaults: [
      // A geom with no colour mapping is one series, so it takes the first hue rather than the
      // engine's own default.
      style.geom({ fill: series[0].hex }),
      style.graph({
        fill: term.surface,
        cornerRadius: 0,
        padding: 20,
        fontFamily: MONO,
        textColor: term.text,
      }),
      style.axisLabel({ ...label, textColor: term.dim }),
      style.tickLabel({ ...label, textColor: term.dim }),
      // No text colour on a value inside its mark: an authored one is painted as is, and only an
      // unset one is picked for contrast against the tile or bar behind it. Values outside their
      // mark and category names run over the surface, so they take its ink.
      style.dataLabel(label),
      style.dataLabel.observation.outside({ textColor: term.text }),
      style.dataLabel.category({ textColor: term.text }),
      style.legendItem({ ...label, textColor: term.dim }),
      style.gridLine({ dashArray: DOTTED_GRID, strokeWidth: 1, stroke: term.chrome }),
      style.tickLine({ stroke: term.chrome }),
      style.panelBorder({ dashArray: [], strokeWidth: 1, stroke: term.border, cornerRadius: 0 }),
      // A stacked band's edge is a line layer of its own, so a stacked area paints no stroke;
      // overlapping areas and session segments stroke their own tops. A donut's edges are stroked by
      // the donut itself.
      style.geom.area({ fillAlpha: FILL_ALPHA, strokeWidth: 0 }),
      style.geom.area({ strokeWidth: 1.5 }, { layer: OVERLAP_LAYER }),
      style.geom.area({ strokeWidth: 1.5 }, { layer: SESSIONS_LAYER }),
      style.geom.bar({ fillAlpha: FILL_ALPHA, strokeWidth: 0 }, { layer: DONUT_LAYER }),
      style.geom.bar({ strokeWidth: 0 }, { layer: BARS_LAYER }),
      style.geom.line({ strokeWidth: 1.5 }),
      // A lone series' bars and dots take the same faint fill under an outline in their hue. A
      // flat bar's alpha fades its outline with its fill, so its tint is mixed in advance instead.
      style.geom.point({ size: 5, fillAlpha: FILL_ALPHA, stroke: series[0].hex, strokeWidth: 1.5 }),
      style.geom.point({ size: 0, strokeWidth: 0 }, { layer: SESSION_TOTALS_LAYER }),
      style.geom.bar({
        cornerRadius: 'none',
        fill: tint(series[0].hex, term.surface, FILL_ALPHA),
        stroke: series[0].hex,
        strokeWidth: 1.5,
      }),
      // Markers are inked apart from every series hue. Their names sit over the bands, so a halo
      // in the surface's colour lifts them off whatever band runs behind.
      style.geom.rule({ stroke: term.ink, strokeWidth: 1, dashArray: DASHED_RULE }),
      style.annotation.text({
        ...label,
        textColor: term.ink,
        textOutlineColor: term.surface,
        textOutlineWidth: 2,
        textShadow: { offsetX: 0, offsetY: 0, blur: 4, color: term.surface },
      }),
    ],
  });
  const palettes: ProviderProps['customPalettes'] = { [PALETTE_ID]: series };
  // A fold of several entities is no one entity, so it takes the muted ink rather than a hue.
  const neutral = term.dim;
  return { stylesheet, palettes, neutral };
}

// Built once per scheme, so a re-render hands the provider the same objects.
const THEMES: Record<ColorScheme, ReturnType<typeof themeFor>> = {
  dark: themeFor('dark'),
  light: themeFor('light'),
};

export function chartTheme(scheme: ColorScheme) {
  return THEMES[scheme];
}

export const terminalConfig = config({
  legend: { position: 'top' },
  content: { brandMark: { enabled: false } },
  axes: {
    x: { position: 'bottom', grid: { isVisible: false } },
    y: { position: 'left', grid: { isVisible: true } },
  },
});
