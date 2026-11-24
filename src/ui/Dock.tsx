import { Circle, Image as ImageIcon, MousePointer2, Plus, Square, Triangle, Type, Hexagon, Star, PenTool, Brush } from 'lucide-react';
import { useDoc } from '@/store/doc';
import { useUi } from '@/store/ui';
import { addOutline, pickEraser, pickInk, pickPhoto, setTool, type AddKind } from '@/actions';
import { ToolButton, useIsWide } from './primitives';
import { CurveIcon, EraseIcon, LineIcon } from './icons';

interface AddItem {
  kind: AddKind | 'text' | 'photo';
  label: string;
  keys?: string;
  icon: React.ReactNode;
  advanced?: boolean;
}

const ADD: AddItem[] = [
  { kind: 'circle', label: 'Circle', keys: 'O', icon: <Circle /> },
  { kind: 'line', label: 'Line', keys: 'L', icon: <LineIcon /> },
  { kind: 'rect', label: 'Square', keys: 'R', icon: <Square /> },
  { kind: 'triangle', label: 'Triangle', icon: <Triangle /> },
  { kind: 'polygon', label: 'Polygon', icon: <Hexagon />, advanced: true },
  { kind: 'star', label: 'Star', icon: <Star />, advanced: true },
  { kind: 'curve', label: 'Curve', keys: 'U', icon: <CurveIcon /> },
  { kind: 'text', label: 'Text', keys: 'T', icon: <Type /> },
  { kind: 'photo', label: 'Photo', keys: 'P', icon: <ImageIcon /> },
];

export function openPhoto(): void {
  const { doc } = useDoc.getState();
  const ref = doc.refs[doc.refs.length - 1];
  // With a photo already placed, the button opens its controls instead of the file picker.
  if (ref && useUi.getState().mode === 'classic') useUi.setState({ tool: 'arrange', erasing: false, selection: [ref.id], trayOpen: false });
  else pickPhoto();
}

function run(item: AddItem): void {
  if (item.kind === 'text') useUi.setState({ sheet: 'text', textTarget: null, trayOpen: false, tool: 'arrange', erasing: false });
  else if (item.kind === 'photo') openPhoto();
  else addOutline(item.kind);
}

function AddButtons({ advanced }: { advanced: boolean }) {
  return (
    <>
      {ADD.filter((a) => advanced || !a.advanced).map((a) => (
        <ToolButton key={a.kind} label={a.label} keys={a.keys} icon={a.icon} onClick={() => run(a)} />
      ))}
    </>
  );
}

export function Dock() {
  const wide = useIsWide();
  const tool = useUi((s) => s.tool);
  const erasing = useUi((s) => s.erasing);
  const ink = useUi((s) => s.ink);
  const trayOpen = useUi((s) => s.trayOpen);
  const mode = useUi((s) => s.mode);
  const palette = useDoc((s) => s.doc.palette);
  const advanced = mode === 'advanced';
  const inline = wide && !advanced;
  const swatches = advanced ? palette : palette.slice(0, 3);

  return (
    <>
      {!inline && trayOpen && (
        <div className="glass bar rise scroll-x" role="toolbar" aria-label="Add">
          <AddButtons advanced={advanced} />
        </div>
      )}
      <div className="glass bar scroll-x" role="toolbar" aria-label="Tools">
        <ToolButton label="Move" keys="V" icon={<MousePointer2 />} active={tool === 'arrange' && !trayOpen} onClick={() => setTool('arrange')} />
        {inline ? (
          <>
            <span className="sep" />
            <AddButtons advanced={false} />
          </>
        ) : (
          <ToolButton
            label="Add"
            keys="A"
            icon={<Plus />}
            active={trayOpen}
            onClick={() => useUi.setState({ trayOpen: !trayOpen, tool: 'arrange', erasing: false })}
          />
        )}
        {advanced && (
          <>
            <ToolButton label="Pen" keys="N" icon={<PenTool />} active={tool === 'pen'} onClick={() => setTool('pen')} />
            <ToolButton label="Brush" keys="B" icon={<Brush />} active={tool === 'brush'} onClick={() => setTool('brush')} />
          </>
        )}
        <span className="sep" />
        {swatches.map((c, i) => (
          <button
            key={i}
            type="button"
            className="swatch"
            aria-label={`Color ${i + 1}`}
            aria-pressed={tool === 'color' && !erasing && ink === i}
            data-active={(tool === 'color' || tool === 'brush') && !erasing && ink === i}
            onClick={() => (tool === 'brush' ? useUi.setState({ ink: i }) : pickInk(i))}
          >
            <span className="swatch-dot" style={{ background: c }} />
          </button>
        ))}
        {advanced && (
          <ToolButton
            label="Color"
            icon={<Plus />}
            onClick={() => {
              const st = useDoc.getState();
              const next = [...st.doc.palette, '#888888'];
              st.commit({ ...st.doc, palette: next, updatedAt: Date.now() });
              useUi.setState({ editing: next.length - 1, sheet: 'colors' });
            }}
          />
        )}
        <ToolButton label="Erase" keys="E" icon={<EraseIcon />} active={tool === 'color' && erasing} onClick={pickEraser} />
      </div>
    </>
  );
}
