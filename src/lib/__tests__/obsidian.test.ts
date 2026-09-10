import { describe, expect, it } from "vitest";

import { noteName, noteUrl } from "../obsidian";

describe("noteName", () => {
  it("takes the note out of a vault-relative path", () => {
    expect(noteName("Vault/Time Tracking/2026-09-08.md")).toBe("2026-09-08");
    expect(noteName("2026-09.md")).toBe("2026-09");
  });

  it("copes with a path that is not one", () => {
    expect(noteName("Weekly/2026-W37.md")).toBe("2026-W37");
    expect(noteName("Projects/Acme Rollout.MD")).toBe("Acme Rollout");
    expect(noteName("plain")).toBe("plain");
    expect(noteName("trailing/slash/")).toBe("slash");
  });

  it("leaves a dot inside the name alone", () => {
    expect(noteName("Notes/v1.2 release.md")).toBe("v1.2 release");
  });
});

describe("noteUrl", () => {
  it("escapes what a vault name and a note may contain", () => {
    expect(noteUrl("My Vault", "2026-09-08")).toBe(
      "obsidian://open?vault=My%20Vault&file=2026-09-08",
    );
    expect(noteUrl(" Vault ", "Acme & Co")).toContain("file=Acme%20%26%20Co");
  });
});
