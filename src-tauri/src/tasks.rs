//! Reading the open tasks out of a vault note.
//!
//! An Obsidian daily note usually already says what the day is meant to be
//! spent on. Retyping that into a time tracker is the friction this removes:
//! the tasks come back as one-tap starts.

use crate::models::VaultTask;

/// Tasks written as Markdown checkboxes, outside Tempo's own block.
///
/// Anything between the markers was written by this app, so a checkbox there
/// would be its own output coming back — never a task someone set themselves.
pub fn parse(note: &str) -> Vec<VaultTask> {
    let mut tasks = Vec::new();
    let mut inside_block = false;
    let mut in_code_fence = false;

    for line in note.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with(crate::markdown::BEGIN) {
            inside_block = true;
            continue;
        }
        if trimmed.starts_with(crate::markdown::END) {
            inside_block = false;
            continue;
        }
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_code_fence = !in_code_fence;
            continue;
        }
        if inside_block || in_code_fence {
            continue;
        }

        let Some(task) = checkbox(trimmed) else {
            continue;
        };
        tasks.push(task);
    }

    tasks
}

/// One line, if it is a task. `- [ ] text`, `* [x] text` and `1. [ ] text` all
/// count; the marker has to be a single character, so `[[a link]]` at the start
/// of a plain bullet is not mistaken for one.
fn checkbox(line: &str) -> Option<VaultTask> {
    let rest = line
        .strip_prefix("- ")
        .or_else(|| line.strip_prefix("* "))
        .or_else(|| line.strip_prefix("+ "))
        .or_else(|| ordered(line))?;

    let rest = rest.trim_start();
    let mut chars = rest.chars();
    if chars.next()? != '[' {
        return None;
    }
    let mark = chars.next()?;
    if chars.next()? != ']' {
        return None;
    }

    let text = rest[3..].trim();
    if text.is_empty() {
        return None;
    }

    Some(VaultTask {
        // Obsidian treats anything but a space as done — x, X, /, -, whatever
        // the user's theme uses for "in progress" or "cancelled".
        done: mark != ' ',
        project: project_of(text),
        text: clean(text),
    })
}

/// `12. [ ] text` — a numbered list item.
fn ordered(line: &str) -> Option<&str> {
    let digits = line.find(|c: char| !c.is_ascii_digit())?;
    if digits == 0 {
        return None;
    }
    line[digits..]
        .strip_prefix(". ")
        .or_else(|| line[digits..].strip_prefix(") "))
}

/// A `[[wikilink]]` in the task names the project, which is exactly what the
/// "a note per project" setting already writes into the vault.
fn project_of(text: &str) -> Option<String> {
    let start = text.find("[[")?;
    let end = text[start + 2..].find("]]")? + start + 2;
    let inner = text[start + 2..end].trim();
    // `[[Project|shown as this]]` links to the left-hand side.
    let target = inner.split('|').next()?.trim();
    // A heading or block link points inside a note, not at it.
    let target = target.split(['#', '^']).next()?.trim();
    (!target.is_empty()).then(|| target.to_string())
}

/// The task as a person would read it: no link syntax, no trailing metadata
/// that plugins hang off the end of a line.
fn clean(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(start) = rest.find("[[") {
        out.push_str(&rest[..start]);
        let Some(end) = rest[start + 2..].find("]]") else {
            break;
        };
        let inner = &rest[start + 2..start + 2 + end];
        // Show the alias when there is one, the note name otherwise.
        let shown = inner.split('|').next_back().unwrap_or(inner);
        out.push_str(shown.trim());
        rest = &rest[start + 2 + end + 2..];
    }
    out.push_str(rest);

    // Dataview and Tasks emoji metadata: due dates, priorities, recurrence.
    let cut = out
        .find(['📅', '⏳', '🛫', '➕', '✅', '🔁', '⏫', '🔽', '🔼'])
        .unwrap_or(out.len());
    out[..cut].split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(note: &str) -> Vec<String> {
        parse(note).into_iter().map(|t| t.text).collect()
    }

    #[test]
    fn finds_the_checkboxes_in_a_daily_note() {
        let note = "# Monday\n\n- [ ] Fix the API\n- [x] Stand-up\n* [ ] Review the PR\n+ [ ] Call Lena\n3. [ ] Write the invoice\n";
        assert_eq!(
            texts(note),
            [
                "Fix the API",
                "Stand-up",
                "Review the PR",
                "Call Lena",
                "Write the invoice"
            ],
        );
        assert_eq!(
            parse(note).iter().map(|t| t.done).collect::<Vec<_>>(),
            [false, true, false, false, false],
        );
    }

    #[test]
    fn anything_but_a_space_is_done() {
        // Themes use /, -, > and more for in-progress and cancelled.
        let marks = parse("- [x] a\n- [X] b\n- [/] c\n- [-] d\n- [ ] e\n");
        assert_eq!(
            marks.iter().map(|t| t.done).collect::<Vec<_>>(),
            [true, true, true, true, false],
        );
    }

    #[test]
    fn a_wikilink_names_the_project() {
        let tasks = parse("- [ ] Fix the login on [[Acme Rollout]]\n");
        assert_eq!(tasks[0].project.as_deref(), Some("Acme Rollout"));
        assert_eq!(tasks[0].text, "Fix the login on Acme Rollout");
    }

    #[test]
    fn an_aliased_link_shows_the_alias_and_links_the_note() {
        let tasks = parse("- [ ] Ship [[Acme Rollout|the rollout]]\n");
        assert_eq!(tasks[0].project.as_deref(), Some("Acme Rollout"));
        assert_eq!(tasks[0].text, "Ship the rollout");
    }

    #[test]
    fn a_heading_link_still_points_at_the_note() {
        let tasks = parse("- [ ] See [[Acme Rollout#Scope]]\n");
        assert_eq!(tasks[0].project.as_deref(), Some("Acme Rollout"));
    }

    #[test]
    fn ignores_what_tempo_wrote_itself() {
        let note = format!(
            "- [ ] Real task\n\n{}\n- [ ] Not a task, this is our block\n{}\n\n- [ ] Another real one\n",
            crate::markdown::BEGIN,
            crate::markdown::END,
        );
        assert_eq!(texts(&note), ["Real task", "Another real one"]);
    }

    #[test]
    fn ignores_checkboxes_inside_a_code_fence() {
        let note = "- [ ] Real\n\n```md\n- [ ] An example in a snippet\n```\n\n- [ ] Also real\n";
        assert_eq!(texts(note), ["Real", "Also real"]);
    }

    #[test]
    fn a_bullet_starting_with_a_link_is_not_a_task() {
        assert!(parse("- [[Acme Rollout]] is the project\n").is_empty());
    }

    #[test]
    fn plain_bullets_and_prose_are_not_tasks() {
        assert!(
            parse("# Monday\n\nSome prose.\n\n- a plain bullet\n- [ok] not a checkbox\n")
                .is_empty()
        );
    }

    #[test]
    fn an_empty_checkbox_has_nothing_to_track() {
        assert!(parse("- [ ] \n- [x]  \n").is_empty());
    }

    #[test]
    fn indented_subtasks_count_too() {
        assert_eq!(
            texts("- [ ] Parent\n    - [ ] Child\n"),
            ["Parent", "Child"]
        );
    }

    #[test]
    fn drops_the_metadata_plugins_hang_off_the_end() {
        assert_eq!(
            texts("- [ ] Fix the API 📅 2026-09-11 ⏫\n"),
            ["Fix the API"]
        );
    }

    #[test]
    fn a_task_with_no_link_has_no_project() {
        assert_eq!(parse("- [ ] Just a task\n")[0].project, None);
    }
}
