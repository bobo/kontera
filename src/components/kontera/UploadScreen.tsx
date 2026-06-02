"use client";

import { useRef, useState } from "react";
import type { Strings } from "@/lib/i18n";

export function UploadScreen({
  t,
  error,
  onFile,
}: {
  t: Strings;
  error: string | null;
  onFile: (file: File) => void;
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function useSample() {
    const res = await fetch("/sample-invoice.pdf");
    const blob = await res.blob();
    onFile(new File([blob], "simple_invoice.pdf", { type: "application/pdf" }));
  }

  return (
    <div className="screen-center">
      <div className="upload-kicker">{t.upload_kicker}</div>
      <h1 className="upload-title">{t.upload_title}</h1>
      <p className="upload-sub">{t.upload_sub}</p>
      <div
        className={"dropzone" + (drag ? " is-drag" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <div className="dz-icon" aria-hidden="true">
          <span className="dz-doc" />
          <span className="dz-arrow">↑</span>
        </div>
        <div className="dz-cta">{t.upload_cta}</div>
        <div className="dz-or">{t.upload_or}</div>
        <div className="dz-hint">{t.upload_hint}</div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
      </div>
      <button className="sample-link" onClick={useSample}>
        <span className="sample-doc" aria-hidden="true" />
        {t.upload_sample} <span className="sample-file mono">simple_invoice.pdf</span>
      </button>
      {error && <div className="upload-error">{error}</div>}
    </div>
  );
}
