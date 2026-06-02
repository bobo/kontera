"use client";

import { useEffect, useState } from "react";
import type { Strings } from "@/lib/i18n";

/**
 * Purely visual. The real pipeline runs in the background; the orchestrator
 * advances to Review when the data is ready, so this just animates the stages
 * and holds on the last one if the request takes longer than the animation.
 */
export function ProcessingScreen({ t }: { t: Strings }) {
  const labels = [t.proc_s1, t.proc_s2, t.proc_s3, t.proc_s4];
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActive((a) => Math.min(a + 1, labels.length - 1));
    }, 750);
    return () => clearInterval(id);
  }, [labels.length]);

  return (
    <div className="screen-center">
      <div className="proc-orb" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h1 className="proc-title">{t.proc_title}</h1>
      <p className="upload-sub">{t.proc_sub}</p>
      <ul className="proc-steps">
        {labels.map((label, i) => {
          const state = i < active ? "done" : i === active ? "doing" : "todo";
          return (
            <li key={i} className={"proc-step proc-" + state}>
              <span className="proc-tick">
                {state === "done" ? "✓" : state === "doing" ? <span className="spin" /> : ""}
              </span>
              {label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
