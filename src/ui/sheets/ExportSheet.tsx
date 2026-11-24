import { useMemo, useState } from 'react';
import { Check, Copy, Crop, Download, Share2 } from 'lucide-react';
import { board } from '@/model/doc';
import { editFrame } from '@/actions';
import { toast } from 'sonner';
import { useDoc } from '@/store/doc';
import { useUi } from '@/store/ui';
import { docToSvg, svgDataUrl, type SvgOptions } from '@/export/svg';
import { copyText, download, fileBase, rasterBlob, shareOrDownload, svgBlob } from '@/export/files';
import { Segmented, Sheet, Tip } from '../primitives';

/** A switch row. The hint shows on hover with a mouse. */
function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const row = (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="row-btn" style={{ paddingLeft: 4, paddingRight: 4 }} onClick={() => onChange(!checked)}>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
      </span>
      <span
        aria-hidden
        style={{
          width: 46,
          height: 28,
          borderRadius: 999,
          flexShrink: 0,
          padding: 2,
          background: checked ? 'var(--accent)' : 'var(--pressed)',
          transition: 'background-color 200ms var(--ease-out)',
        }}
      >
        <span
          style={{
            display: 'block',
            width: 24,
            height: 24,
            borderRadius: 999,
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,.3)',
            transform: `translateX(${checked ? 18 : 0}px)`,
            transition: 'transform 200ms var(--ease-out)',
          }}
        />
      </span>
    </button>
  );
  return hint ? (
    <Tip label={hint} side="right">
      {row}
    </Tip>
  ) : (
    row
  );
}

export function ExportSheet() {
  const open = useUi((s) => s.sheet === 'export');
  const mode = useUi((s) => s.mode);
  const doc = useDoc((s) => s.doc);
  const frame = board(doc);
  const [background, setBackground] = useState(false);
  const [guides, setGuides] = useState(false);
  const [content, setContent] = useState(false);
  const [size, setSize] = useState<'512' | '1024' | '2048' | '4096'>('1024');
  const [format, setFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [copied, setCopied] = useState(false);
  const opts: Partial<SvgOptions> = useMemo(
    () => ({ background, guides, crop: content ? 'content' : 'artboard' }),
    [background, guides, content],
  );
  const preview = useMemo(() => (open ? svgDataUrl(docToSvg(doc, opts)) : ''), [open, doc, opts]);
  const empty = doc.shapes.length === 0 && !(guides && doc.guides.length);
  const base = fileBase(doc);
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  const savePng = async (share: boolean): Promise<void> => {
    try {
      const type = `image/${format}`;
      const blob = await rasterBlob(doc, opts, Number(size), type);
      const name = `${base}.${format === 'jpeg' ? 'jpg' : format}`;
      if (share) await shareOrDownload(blob, name);
      else download(blob, name);
    } catch {
      toast.error('The image could not be created.');
    }
  };

  return (
    <Sheet open={open} onClose={() => useUi.setState({ sheet: null })} title="Export" place="top-right">
      <div
        className="swatch-clear flex items-center justify-center overflow-hidden rounded-2xl"
        style={{ aspectRatio: '16 / 10', boxShadow: 'inset 0 0 0 1px var(--border)' }}
      >
        {empty ? (
          <span className="rounded-lg bg-surface px-3 py-1.5 text-[13px] text-muted">Nothing colored yet</span>
        ) : (
          preview && <img src={preview} alt="Logo preview" style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }} />
        )}
      </div>

      <div className="mt-2">
        <Toggle label="Background" hint="Off keeps the logo transparent" checked={background} onChange={setBackground} />
        <Toggle label="Construction lines" hint="Show the outlines the logo was built from" checked={guides} onChange={setGuides} />
        {mode === 'advanced' && <Toggle label="Crop to artwork" hint="Trim the empty space around the logo" checked={content} onChange={setContent} />}
        <Tip label="Move or resize what gets exported" side="right">
          <button type="button" className="row-btn" style={{ paddingLeft: 4, paddingRight: 4 }} onClick={() => editFrame(true)}>
            <span className="min-w-0 flex-1 text-[15px] font-medium">Export frame</span>
            <span className="text-[13px] text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(frame.w)} by {Math.round(frame.h)}
            </span>
            <Crop />
          </button>
        </Tip>
      </div>

      <div className="mt-3 grid gap-2">
        <button type="button" className="btn" data-variant="primary" data-size="lg" disabled={empty} onClick={() => download(svgBlob(doc, opts), `${base}.svg`)}>
          <Download />
          Download SVG
        </button>
        <div className="flex items-center gap-2">
          <button type="button" className="btn flex-1" data-size="lg" disabled={empty} onClick={() => void savePng(false)}>
            <Download />
            {format === 'png' ? 'PNG' : format === 'jpeg' ? 'JPG' : 'WebP'}
          </button>
          <Segmented
            label="Image size"
            value={size}
            onChange={setSize}
            options={[
              { value: '512', label: '512' },
              { value: '1024', label: '1024' },
              { value: '2048', label: '2048' },
              ...(mode === 'advanced' ? [{ value: '4096' as const, label: '4096' }] : []),
            ]}
          />
        </div>
        {mode === 'advanced' && (
          <Segmented
            label="Image format"
            value={format}
            onChange={setFormat}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPG' },
              { value: 'webp', label: 'WebP' },
            ]}
          />
        )}
        <div className="flex gap-2">
          <button
            type="button"
            className="btn flex-1"
            data-size="lg"
            disabled={empty}
            onClick={async () => {
              const ok = await copyText(docToSvg(doc, opts));
              if (ok) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              } else toast.error('Copying was blocked by the browser.');
            }}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy SVG code'}
          </button>
          {canShare && (
            <button type="button" className="btn flex-1" data-size="lg" disabled={empty} onClick={() => void savePng(true)}>
              <Share2 />
              Share
            </button>
          )}
        </div>
        {mode === 'advanced' && (
          <button type="button" className="chip mx-auto" disabled={empty} onClick={() => useUi.setState({ sheet: 'code' })}>
            View SVG code
          </button>
        )}
      </div>
    </Sheet>
  );
}
