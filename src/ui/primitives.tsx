import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Popover } from '@base-ui/react/popover';
import { Drawer } from '@base-ui/react/drawer';
import { Slider as BaseSlider } from '@base-ui/react/slider';
import { Tooltip } from '@base-ui/react/tooltip';
import { Info, X } from 'lucide-react';

export { useIsPhone, useIsTouch } from '@/store/settings';
import { useLayoutKind } from '@/store/settings';

/** Wide enough to lay the whole dock out in one row. */
export function useIsWide(): boolean {
  const q = '(min-width: 900px)';
  const [wide, setWide] = useState(() => (typeof matchMedia === 'function' ? matchMedia(q).matches : true));
  useEffect(() => {
    const m = matchMedia(q);
    const on = (): void => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

// --- Tooltip ----------------------------------------------------------------

export function Tip({ label, keys, children, side = 'top' }: { label: string; keys?: string; children: ReactElement; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={10} style={{ zIndex: 60 }}>
          <Tooltip.Popup className="tip">
            {label}
            {keys && <kbd>{keys}</kbd>}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export const TipProvider = Tooltip.Provider;

/**
 * A small (i) that explains the thing beside it, in place of a line of small
 * print. Opens on hover with a mouse and on a tap with a finger.
 */
export function InfoTip({ text, about }: { text: string; about: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="info-btn" aria-label={`About ${about}`} openOnHover delay={120} closeDelay={80}>
        <Info />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={8} collisionPadding={10} style={{ zIndex: 90 }}>
          <Popover.Popup className="pop info-pop">{text}</Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// --- Buttons ----------------------------------------------------------------

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  keys?: string;
  active?: boolean;
  tipSide?: 'top' | 'bottom' | 'left' | 'right';
}

export function IconButton({ label, keys, active, tipSide = 'bottom', children, ...rest }: IconButtonProps) {
  return (
    <Tip label={label} keys={keys} side={tipSide}>
      <button type="button" className="ib" aria-label={label} aria-pressed={active} data-active={active || undefined} {...rest}>
        {children}
      </button>
    </Tip>
  );
}

interface ToolButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  keys?: string;
  active?: boolean;
  icon: ReactNode;
}

export function ToolButton({ label, keys, active, icon, ...rest }: ToolButtonProps) {
  return (
    <Tip label={label} keys={keys}>
      <button type="button" className="tool" aria-pressed={active} data-active={active || undefined} {...rest}>
        {icon}
        <span>{label}</span>
      </button>
    </Tip>
  );
}

// --- Segmented control ------------------------------------------------------

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  /** `tip` explains an option on hover, with a mouse. */
  options: { value: T; label: string; tip?: string }[];
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState({ x: 0, w: 0 });
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>('button[data-active="true"]');
    if (el) setPill({ x: el.offsetLeft - 3, w: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div className="seg" ref={ref} role="radiogroup" aria-label={label}>
      <span className="seg-pill" style={{ width: pill.w, transform: `translateX(${pill.x}px)` }} />
      {options.map((o) => {
        const b = (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value} data-active={o.value === value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        );
        return o.tip ? (
          <Tip key={o.value} label={o.tip} side="bottom">
            {b}
          </Tip>
        ) : (
          b
        );
      })}
    </div>
  );
}

// --- Slider -----------------------------------------------------------------

/** The number beside a slider: click it to type an exact value. */
function SliderNumber({ value, min, max, format, label, onSet }: { value: number; min: number; max: number; format?: (v: number) => string; label: string; onSet: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const shown = format ? format(value) : String(value);
  const apply = (): void => {
    if (text === null) return;
    const v = parseFloat(text.replace(',', '.'));
    setText(null);
    if (Number.isFinite(v)) onSet(Math.max(min, Math.min(max, v)));
  };
  return (
    <input
      className="slider-num"
      inputMode="decimal"
      aria-label={`${label} value`}
      value={text ?? shown}
      onFocus={(e) => {
        setText(String(value));
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          // Esc abandons what was typed. With nothing typed it is left alone, so it can close whatever panel this is in.
          const typed = text !== null && text !== String(value);
          setText(null);
          e.currentTarget.blur();
          if (typed) e.stopPropagation();
          return;
        }
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

export function Slider({
  value,
  onChange,
  onCommit,
  min,
  max,
  step = 1,
  label,
  format,
  typeMax,
  hideValue,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  format?: (v: number) => string;
  /** Typing into the number may go beyond the slider's own range, up to this. */
  typeMax?: number;
  hideValue?: boolean;
}) {
  return (
    <div className="slider" data-vaul-no-drag>
      <BaseSlider.Root
        value={Math.max(min, Math.min(max, value))}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v as number)}
        onValueCommitted={(v) => onCommit?.(v as number)}
        style={{ flex: 1, minWidth: 0 }}
      >
        <BaseSlider.Control className="slider-control">
          <BaseSlider.Track className="slider-track">
            <BaseSlider.Indicator className="slider-fill" />
            <BaseSlider.Thumb className="slider-thumb" aria-label={label} />
          </BaseSlider.Track>
        </BaseSlider.Control>
      </BaseSlider.Root>
      {!hideValue && (
        <SliderNumber
          value={value}
          min={min}
          max={typeMax ?? max}
          format={format}
          label={label}
          onSet={(v) => {
            onChange(v);
            onCommit?.(v);
          }}
        />
      )}
    </div>
  );
}

// --- Sheet: bottom drawer on phones, centred dialog on larger screens ---------

export type SheetPlace = 'center' | 'top-left' | 'top-right' | 'left';

const MIN_PANEL = 300;
const panelMax = (): number => Math.min(960, window.innerWidth - 40);

/**
 * The width of a side panel that can be dragged wider by its edge, kept per
 * panel for next time. Null until the panel has been dragged (the stylesheet's
 * width applies).
 */
export function usePanelWidth(key: string): [number | null, (w: number | null) => void] {
  const store = `lc.width.${key}`;
  const [w, setW] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem(store));
      return v >= MIN_PANEL ? v : null;
    } catch {
      return null;
    }
  });
  const set = (next: number | null): void => {
    setW(next);
    try {
      if (next === null) localStorage.removeItem(store);
      else localStorage.setItem(store, String(Math.round(next)));
    } catch {
      /* private mode: the width lasts for this visit */
    }
  };
  return [w === null ? null : Math.min(w, panelMax()), set];
}

/**
 * The edge of a side panel, to drag it wider or narrower. Double-click puts it
 * back. `side` is the edge it sits on: right for a panel on the left.
 */
export function PanelEdge({ side, width, onWidth }: { side: 'left' | 'right'; width: number | null; onWidth: (w: number | null) => void }) {
  const from = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      className="panel-edge"
      data-side={side}
      role="separator"
      aria-orientation="vertical"
      aria-label="Drag to resize"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const panel = e.currentTarget.parentElement!;
        from.current = { x: e.clientX, w: width ?? panel.getBoundingClientRect().width };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const f = from.current;
        if (!f) return;
        const d = (e.clientX - f.x) * (side === 'right' ? 1 : -1);
        onWidth(Math.max(MIN_PANEL, Math.min(panelMax(), f.w + d)));
      }}
      onPointerUp={() => (from.current = null)}
      onPointerCancel={() => (from.current = null)}
      onDoubleClick={() => onWidth(null)}
    />
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
  actions,
  place = 'center',
  name,
  note,
  narrow,
}: {
  open: boolean;
  /** `reason` says how: 'close-press' for the X, 'escape-key', 'outside-press' for a click elsewhere. */
  onClose: (reason?: string) => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  actions?: ReactNode;
  /**
   * Where the panel sits on larger screens. Anything but 'center' drops it
   * next to the control that opened it and leaves the canvas visible.
   * Phones always get a bottom sheet.
   */
  place?: SheetPlace;
  /** Remembers the panel's width under this name; defaults to the title. */
  name?: string;
  /** A quiet line after the title. */
  note?: ReactNode;
  /** A short panel (a few rows): keeps its compact width on big screens. */
  narrow?: boolean;
}) {
  // Upright phones get a sheet from the bottom; a phone on its side has the room for a side panel.
  const kind = useLayoutKind();
  const phone = kind === 'phone';
  // Side panels on a desktop can be dragged wider by their inner edge.
  const [width, setWidth] = usePanelWidth(name ?? title);
  const resizable = kind === 'desktop' && place !== 'center';
  const head = (Title: typeof Dialog.Title | typeof Drawer.Title, Close: typeof Dialog.Close | typeof Drawer.Close) => (
    <div className="sheet-head">
      <div className="flex min-w-0 items-baseline">
        <Title className="sheet-title">{title}</Title>
        {note && <span className="sheet-note">{note}</span>}
      </div>
      <div className="flex items-center gap-1">
        {actions}
        <Close className="ib" aria-label="Close">
          <X />
        </Close>
      </div>
    </div>
  );
  if (phone) {
    return (
      <Drawer.Root open={open} onOpenChange={(o) => !o && onClose()}>
        <Drawer.Portal>
          <Drawer.Backdrop className="backdrop" />
          <Drawer.Viewport className="drawer-viewport">
            <Drawer.Popup className="drawer">
              <div className="drawer-grip" />
              {head(Drawer.Title, Drawer.Close)}
              <Drawer.Content className="sheet-body">{children}</Drawer.Content>
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }
  return (
    <Dialog.Root open={open} onOpenChange={(o, details) => !o && onClose(details.reason)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="backdrop" data-clear={place !== 'center' || undefined} />
        <Dialog.Popup className="dialog" data-wide={wide || undefined} data-narrow={narrow || undefined} data-place={place} style={resizable && width ? { width } : undefined}>
          {head(Dialog.Title, Dialog.Close)}
          <div className="sheet-body">{children}</div>
          {resizable && <PanelEdge side={place === 'top-right' ? 'left' : 'right'} width={width} onWidth={setWidth} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
