/**
 * Font settings: the weight, italic and OpenType features of the chosen font,
 * where it has them. Behind a small button beside "Your font".
 */
import { useEffect, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { SlidersHorizontal } from 'lucide-react';
import '@/styles/settings.css';
import { fontDef, loadFont } from '@/text/load';
import { featureChoices, type FeatureChoice } from '@/text/gsub';
import { styleTable, WEIGHT_NAMES, type TextStyle } from '@/text/styles';
import type { FontDef } from '@/text/fonts';
import { Slider } from '../primitives';

// --- the last settings used with each font are kept for next time ---------------------

const KEY = 'lc.fontStyle';

function readAll(): Record<string, TextStyle> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, TextStyle>) : {};
  } catch {
    return {};
  }
}

export function rememberedStyle(fontId: string): TextStyle {
  const s = readAll()[fontId];
  return s
    ? { weight: typeof s.weight === 'number' ? s.weight : undefined, italic: s.italic === true, features: Array.isArray(s.features) ? s.features.filter((f) => typeof f === 'string') : [] }
    : {};
}

export function rememberStyle(fontId: string, style: TextStyle): void {
  try {
    const all = readAll();
    all[fontId] = { weight: style.weight, italic: style.italic || undefined, features: style.features?.length ? style.features : undefined };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private mode: the settings last for this visit */
  }
}

/** The features a font offers, once its file has been read. */
function useFeatures(fontId: string): FeatureChoice[] | null {
  const [state, setState] = useState<{ id: string; list: FeatureChoice[] } | null>(null);
  useEffect(() => {
    let alive = true;
    loadFont(fontId).then(
      (fonts) => alive && setState({ id: fontId, list: featureChoices(fontId, fonts[0]!) }),
      () => alive && setState({ id: fontId, list: [] }),
    );
    return () => {
      alive = false;
    };
  }, [fontId]);
  return state?.id === fontId ? state.list : null;
}

/** The weights of a font (upright or italic), and whether it has an italic, once the table has loaded. */
function useWeights(def: FontDef | undefined, italic: boolean): { weights: number[]; italic: boolean } | null {
  const [state, setState] = useState<{ key: string; weights: number[]; italic: boolean } | null>(null);
  const key = `${def?.id}:${italic}`;
  useEffect(() => {
    let alive = true;
    if (!def) return;
    void styleTable().then((t) => alive && setState({ key, weights: t.fontWeights(def, italic), italic: t.hasItalic(def) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state?.key === key ? state : null;
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="tx-set">
      <span>{label}</span>
      <button type="button" role="switch" className="switch" aria-label={label} aria-checked={on} onClick={() => onChange(!on)}>
        <span className="switch-thumb" />
      </button>
    </div>
  );
}

export function FontSettings({ fontId, style, onChange }: { fontId: string; style: TextStyle; onChange: (s: TextStyle) => void }) {
  const def = fontDef(fontId);
  const italic = !!style.italic;
  const styles = useWeights(def, italic);
  const weights = styles?.weights ?? [];
  const canItalic = !!styles?.italic;
  const features = useFeatures(fontId);
  const on = new Set(style.features ?? []);
  // Nothing to set: no button at all.
  if (!def || (styles !== null && weights.length < 2 && !canItalic && features !== null && features.length === 0)) return null;

  const current = style.weight ?? def.weight ?? 400;
  // nearest weight that exists in this slant
  const index = weights.length ? weights.reduce((best, w, i) => (Math.abs(w - current) < Math.abs(weights[best]! - current) ? i : best), 0) : 0;
  const set = (patch: TextStyle): void => onChange({ ...style, ...patch });

  return (
    <Popover.Root>
      <Popover.Trigger className="tx-pill tx-icon" aria-label="Font settings" title="Font settings">
        <SlidersHorizontal />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={8} style={{ zIndex: 60 }}>
          <Popover.Popup className="pop tx-style" aria-label={`${def.name} settings`}>
            <div className="tx-style-name">{def.name}</div>
            {weights.length > 1 && (
              <div className="tx-style-weight">
                <div className="tx-set">
                  <span>Weight</span>
                  <span className="tx-style-value">{WEIGHT_NAMES[weights[index]!] ?? weights[index]}</span>
                </div>
                <Slider label="Weight" min={0} max={weights.length - 1} value={index} hideValue onChange={(i) => set({ weight: weights[Math.round(i)] })} />
              </div>
            )}
            {canItalic && <Toggle label="Italic" on={italic} onChange={(v) => set({ italic: v })} />}
            {features === null ? (
              <p className="tx-style-wait">Reading font…</p>
            ) : (
              features.map((f) => <Toggle key={f.tag} label={f.label} on={on.has(f.tag)} onChange={(v) => set({ features: v ? [...on, f.tag] : [...on].filter((t) => t !== f.tag) })} />)
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
