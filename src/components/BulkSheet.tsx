import { useState } from "react";

import { useT } from "../lib/i18n";
import type { Entry } from "../lib/types";

type Props = {
  entries: Entry[];
  projects: string[];
  onApply: (project: string | null, addTags: string[]) => void;
  onClose: () => void;
};

/** One change applied to everything a search turned up. */
export function BulkSheet({ entries, projects, onApply, onClose }: Props) {
  const [project, setProject] = useState("");
  const [tags, setTags] = useState("");
  const t = useT();

  const addTags = tags
    .split(",")
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean);
  const ready = project.trim() !== "" || addTags.length > 0;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Edit the matching entries">
        <div className="grabber" />
        <h2>
          {t(entries.length === 1 ? "{n} entry" : "{n} entries", { n: entries.length })}
        </h2>

        <div className="stack">
          <div className="field">
            <label htmlFor="bulk-project">{t("Move to project")}</label>
            <input
              id="bulk-project"
              type="text"
              list="known-projects"
              value={project}
              onChange={(event) => setProject(event.target.value)}
              placeholder="Leave empty to keep them where they are"
            />
            <datalist id="known-projects">
              {projects.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <div className="field">
            <label htmlFor="bulk-tags">{t("Add tags")}</label>
            <input
              id="bulk-tags"
              type="text"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="billable"
            />
            <span className="help">
              Tags are added, never removed — an entry that already has one is left alone.
            </span>
          </div>

          <div className="btn-row">
            <button className="btn" onClick={onClose}>
              {t("Cancel")}
            </button>
            <button
              className={ready ? "btn primary" : "btn"}
              disabled={!ready}
              onClick={() => onApply(project.trim() || null, addTags)}
            >
              {t("Apply to {n}", { n: entries.length })}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
