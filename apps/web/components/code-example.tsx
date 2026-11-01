"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { examples } from "@/lib/examples";
export function CodeExample() {
  const [selected, setSelected] = useState(examples[0]);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(selected.code);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }
  return (
    <div className="code-example">
      <div className="code-toolbar">
        <fieldset aria-label="Code examples">
          {examples.map((example) => (
            <button
              key={example.name}
              type="button"
              aria-pressed={example === selected}
              aria-controls="code-content"
              onClick={() => {
                setSelected(example);
                setCopyStatus("idle");
              }}
            >
              {example.name}
            </button>
          ))}
        </fieldset>
        <button type="button" aria-label="Copy code" onClick={copy}>
          {copyStatus === "copied" ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
      <div className="code-filename">{selected.file}</div>
      <pre
        id="code-content"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll this code panel.
        tabIndex={0}
      >
        <code>{selected.code}</code>
      </pre>
      <div className="code-caption">
        <span>TYPE-SAFE HOST API</span>
        <span aria-live="polite">
          {copyStatus === "copied"
            ? "Copied"
            : copyStatus === "failed"
              ? "Select the code to copy it"
              : "Test mode by default"}
        </span>
      </div>
    </div>
  );
}
