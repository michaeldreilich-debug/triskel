"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { normalizeTags } from "../types";

/** Tags als umrandete Pillen; neue per Enter oder Komma, entfernen per ×. */
export function TagEditor({
  id,
  tags,
  onChange,
}: {
  id: string;
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const next = normalizeTags([...tags, ...draft.split(",")]);
    setDraft("");
    if (next.length !== tags.length) onChange(next);
  };

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 px-2 md:min-h-8">
      {tags.length > 0 ? (
        <ul aria-label="Tags" className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag}
              className="group inline-flex h-6 items-center rounded-full border border-border-strong px-2.5 text-meta text-fg/85"
            >
              <span className="text-faint">#</span>
              {tag}
              <button
                type="button"
                aria-label={`Tag ${tag} entfernen`}
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                className={
                  // Touch: immer sichtbar (größere Trefferfläche); Maus: erscheint bei Hover/Fokus,
                  // in Ruhe ohne Platz – die Pille bleibt symmetrisch
                  "relative -mr-1 ml-1 inline-flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full text-faint " +
                  "transition-[width,margin,opacity] hover:bg-surface-2 hover:text-fg after:absolute after:-inset-3 " +
                  "pointer-fine:mr-0 pointer-fine:ml-0 pointer-fine:w-0 pointer-fine:opacity-0 pointer-fine:after:inset-0 " +
                  "pointer-fine:group-hover:-mr-1 pointer-fine:group-hover:ml-1 pointer-fine:group-hover:w-4 pointer-fine:group-hover:opacity-100 " +
                  "pointer-fine:group-focus-within:-mr-1 pointer-fine:group-focus-within:ml-1 pointer-fine:group-focus-within:w-4 pointer-fine:group-focus-within:opacity-100"
                }
              >
                <X size={12} strokeWidth={1.5} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add();
          } else if (event.key === "Backspace" && !draft && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && add()}
        placeholder={tags.length ? "+ Tag" : "Tag hinzufügen"}
        aria-label="Tag hinzufügen"
        className="h-6 w-24 min-w-0 rounded-control bg-transparent px-1 text-body-lg text-fg placeholder:text-faint focus:w-40 focus-visible:outline-none md:text-ui-sm"
      />
    </div>
  );
}
