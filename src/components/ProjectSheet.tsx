import { useState } from "react";

import { projectColor } from "../lib/colors";
import { TrashIcon } from "./Icons";

type Props = {
  name: string;
  onRename: (to: string) => void;
  onForget: () => void;
  onClose: () => void;
};

export function ProjectSheet({ name, onRename, onForget, onClose }: Props) {
  const [value, setValue] = useState(name);
  const changed = value.trim() !== "" && value.trim() !== name;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Project ${name}`}>
        <div className="grabber" />
        <h2>
          <span className="swatch" style={{ background: projectColor(name) }} />
          {name}
        </h2>

        <div className="stack">
          <div className="field">
            <label htmlFor="project-name">Name</label>
            <input
              id="project-name"
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && changed && onRename(value.trim())}
            />
            <span className="help">
              Renaming updates every entry and rewrites the affected notes on the next sync. Rename
              onto a project that already exists to merge the two.
            </span>
          </div>

          <div className="btn-row">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className={changed ? "btn primary" : "btn"}
              onClick={() => onRename(value.trim())}
              disabled={!changed}
            >
              Rename
            </button>
          </div>

          <button className="btn danger wide" onClick={onForget}>
            <TrashIcon /> Remove from the quick list
          </button>
          <p className="small muted" style={{ margin: 0, textAlign: "center" }}>
            Tracked time is kept — only the chip disappears.
          </p>
        </div>
      </div>
    </>
  );
}
