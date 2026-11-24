import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Drawer } from '@base-ui/react/drawer';
import { Slider as BaseSlider } from '@base-ui/react/slider';
import { Tooltip } from '@base-ui/react/tooltip';
import { X } from 'lucide-react';

/** True on narrow (phone-sized) viewports. */
export function useIsPhone(): boolean {
  const q = '(max-width: 639px)';
  const [phone, setPhone] = useState(() => (typeof matchMedia === 'function' ? matchMedia(q).matches : false));
  useEffect(() => {
    const m = matchMedia(q);
    const on = (): void => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}

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

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState({ x: 0, w: 0 });
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>('button[data-active="true"]');
    if (el) setPill({ x: el.offsetLeft - 3, w: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div className="seg" ref={ref} role="radiogroup" aria-label={label}>
      <span className="seg-pill" style={{ width: pill.w, transform: `translateX(${pill.x}px)` }} />
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} data-active={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// --- Slider -----------------------------------------------------------------

export function Slider({
  value,
  onChange,
  onCommit,
  min,
  max,
  step = 1,
  label,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  format?: (v: number) => string;
}) {
  return (
    <div className="slider" data-vaul-no-drag>
      <BaseSlider.Root
        value={value}
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
      {format && <span className="slider-value">{format(value)}</span>}
    </div>
  );
}

// --- Sheet: bottom drawer on phones, centred dialog on larger screens ---------

export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  actions?: ReactNode;
}) {
  const phone = useIsPhone();
  const head = (Title: typeof Dialog.Title | typeof Drawer.Title, Close: typeof Dialog.Close | typeof Drawer.Close) => (
    <div className="sheet-head">
      <Title className="sheet-title">{title}</Title>
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
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="backdrop" />
        <Dialog.Popup className="dialog" data-wide={wide || undefined}>
          {head(Dialog.Title, Dialog.Close)}
          <div className="sheet-body">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
