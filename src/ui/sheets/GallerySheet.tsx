import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useDoc } from "@/store/doc";
import { useUi } from "@/store/ui";
import {
  deleteDoc,
  listDocs,
  loadDoc,
  saveDoc,
  type DocMeta,
} from "@/store/persist";
import { createNewDoc, openDoc } from "@/actions";
import { EXAMPLES, type Example } from "@/examples";
import { svgDataUrl, thumbnail } from "@/export/svg";
import type { Doc } from "@/model/types";
import { isEmptyDoc } from "@/model/doc";
import { Segmented, Sheet, Tip } from "../primitives";

function Card({
  thumb,
  name,
  sub,
  tip,
  onOpen,
  onDelete,
  current,
}: {
  thumb: string;
  name: string;
  sub?: string;
  tip?: string;
  onOpen: () => void;
  onDelete?: () => void;
  current?: boolean;
}) {
  const open = (
    <button
      type="button"
      onClick={onOpen}
      className="row-btn"
      style={{
        flexDirection: "column",
        alignItems: "stretch",
        gap: 6,
        padding: 6,
        background: "var(--sunken)",
        boxShadow: current ? "inset 0 0 0 2px var(--accent)" : undefined,
      }}
    >
      <span
        className="block overflow-hidden rounded-[10px] bg-white"
        style={{ aspectRatio: "1 / 1" }}
      >
        {thumb && (
          <img
            src={thumb}
            alt=""
            style={{ width: "100%", height: "100%", display: "block" }}
            draggable={false}
          />
        )}
      </span>
      <span className="block min-w-0 px-1 pb-0.5">
        <span className="block truncate text-[13.5px] font-semibold">
          {name || "Untitled logo"}
        </span>
        {sub && (
          <span className="block truncate text-[12px] text-muted">{sub}</span>
        )}
      </span>
    </button>
  );
  return (
    <div className="relative">
      {tip ? (
        <Tip label={tip} side="bottom">
          {open}
        </Tip>
      ) : (
        open
      )}
      {onDelete && (
        <button
          type="button"
          className="ib"
          aria-label={`Delete ${name}`}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 32,
            height: 32,
            background: "var(--surface)",
          }}
          onClick={onDelete}
        >
          <Trash2 style={{ width: 16, height: 16 }} />
        </button>
      )}
    </div>
  );
}

const ago = (t: number): string => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return new Date(t).toLocaleDateString();
};

function ExampleCard({ ex }: { ex: Example }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  useEffect(() => {
    let alive = true;
    void ex
      .build()
      .then((d) => alive && setDoc(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ex]);
  return (
    <Card
      thumb={doc ? svgDataUrl(thumbnail(doc)) : ""}
      name={ex.name}
      tip={ex.note}
      onOpen={() => {
        if (doc) openDoc(doc);
      }}
    />
  );
}

export function GallerySheet() {
  const open = useUi((s) => s.sheet === "gallery");
  const tab = useUi((s) => s.galleryTab);
  const currentId = useDoc((s) => s.doc.id);
  const [docs, setDocs] = useState<DocMeta[]>([]);

  const refresh = (): void =>
    void listDocs()
      .then(setDocs)
      .catch(() => setDocs([]));
  useEffect(() => {
    if (!open) return;
    // Make sure the logo being worked on is in the list with a fresh preview.
    const cur = useDoc.getState().doc;
    if (isEmptyDoc(cur)) refresh();
    else
      void saveDoc(cur, thumbnail(cur))
        .catch(() => undefined)
        .then(refresh);
  }, [open]);

  const remove = async (m: DocMeta): Promise<void> => {
    const doc = await loadDoc(m.id);
    await deleteDoc(m.id);
    if (m.id === currentId) createNewDoc();
    refresh();
    toast(`Deleted “${m.name || "Untitled logo"}”`, {
      action: doc
        ? {
            label: "Undo",
            onClick: () => void saveDoc(doc, m.thumb).then(refresh),
          }
        : undefined,
    });
  };

  return (
    <Sheet
      open={open}
      onClose={() => useUi.setState({ sheet: null })}
      title="Logos"
      wide
    >
      <div className="pb-3">
        <Segmented
          label="Show"
          value={tab}
          onChange={(v) => useUi.setState({ galleryTab: v })}
          options={[
            { value: "mine", label: "My logos" },
            { value: "examples", label: "Examples" },
          ]}
        />
      </div>
      {tab === "mine" ? (
        docs.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {docs.map((m) => (
              <Card
                key={m.id}
                thumb={m.thumb ? svgDataUrl(m.thumb) : ""}
                name={m.name}
                sub={ago(m.updatedAt)}
                current={m.id === currentId}
                onOpen={() => void loadDoc(m.id).then((d) => d && openDoc(d))}
                onDelete={() => void remove(m)}
              />
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-[14px] text-muted">
            Logos you make are saved here automatically.
          </p>
        )
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {EXAMPLES.map((ex) => (
            <ExampleCard key={ex.id} ex={ex} />
          ))}
        </div>
      )}
    </Sheet>
  );
}
