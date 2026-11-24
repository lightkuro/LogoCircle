import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useDoc } from '@/store/doc';
import { useUi } from '@/store/ui';
import { docToSvg } from '@/export/svg';
import { copyText } from '@/export/files';
import { Sheet } from '../primitives';

/** Advanced: read (and copy) the SVG the logo exports to. */
export function CodeSheet() {
  const open = useUi((s) => s.sheet === 'code');
  const doc = useDoc((s) => s.doc);
  const [copied, setCopied] = useState(false);
  const code = useMemo(() => (open ? docToSvg(doc).replace(/></g, '>\n<') : ''), [open, doc]);
  return (
    <Sheet
      open={open}
      onClose={() => useUi.setState({ sheet: null })}
      title="SVG code"
      wide
      actions={
        <button
          type="button"
          className="chip"
          onClick={async () => {
            if (await copyText(code)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      }
    >
      <pre
        className="m-0 overflow-auto rounded-xl bg-sunken p-3 text-[12px] leading-relaxed"
        style={{ maxHeight: '60dvh', whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'text', WebkitUserSelect: 'text', touchAction: 'pan-y' }}
      >
        <code>{code}</code>
      </pre>
      <p className="mb-0 mt-2 text-[12.5px] text-muted">{new Blob([code]).size.toLocaleString()} bytes</p>
    </Sheet>
  );
}
