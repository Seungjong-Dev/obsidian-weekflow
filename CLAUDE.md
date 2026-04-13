# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**WeekFlow** is an Obsidian plugin for weekly timetable-based time management and review. It reads/writes data from daily notes' markdown lists (not frontmatter) and renders them as a weekly timetable grid. See `SPEC.md` for full specification.

## Key Architecture Decisions

- **Data lives in daily notes**, not in a separate data store. The timetable is a view that aggregates 7 daily notes.
- **Timeline items are Tasks-plugin-compatible checkboxes** under a configurable heading (default: `## Timeline`).
- **Checkbox state determines item type**: `- [ ]` = Plan, `- [x]` = Actual, `- [>]` = Deferred.
- **Plan vs Actual on same line**: `- [x] 09:00-11:00 > 09:00-10:30 content #tag` (plan time > actual time).
- **All configurable values** (headings, paths, tags, statuses) come from plugin settings. Never hardcode vault-specific values.
- **Path patterns use moment.js** format (e.g., `5. Periodic Notes/YYYY/MM/YYYY-MM-DD`).

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development build with hot reload
npm run build        # Production build
```

Output goes to `main.js`, `manifest.json`, and `styles.css` in the repo root for Obsidian to load.

## Testing

For testing within Obsidian, symlink or copy the repo into an Obsidian vault's `.obsidian/plugins/weekflow/` directory.

## Timeline Item Format

```
- [ ] HH:MM-HH:MM content #category [Tasks metadata...]
- [x] HH:MM-HH:MM > HH:MM-HH:MM content #category [Tasks metadata...]
- [>] HH:MM-HH:MM content #category [Tasks metadata...]
```

WeekFlow parses time ranges and the `>` separator; all other content (tags, Tasks emoji metadata like `📅`, `⏫`, `🔁`) is preserved verbatim.

## Critical Parsing Rules

1. Find the configured heading, parse checkbox list items until next heading or EOF.
2. Time ranges use `-` not `~` as separator: `09:00-11:00`.
3. End time before start time is a parse error (overnight items must be split at midnight).
4. Times are stored with 1-minute precision. Grid cells are 10 minutes; sub-cell offsets are rendered via proportional `left`/`right` positioning.

## Project Integration

- Project tasks are referenced via Obsidian block references: `[[Project Note#^task-id]]`.
- Tasks are **copied** to timeline (not moved) — project notes remain untouched.
- On completion, prompt user whether to also complete the source project task.

## Deferred Logic

- Moving a past-date `- [ ]` item to another day → mark original as `- [>]`, create new `- [ ]`.
- Moving a today/future `- [ ]` item → simple move (delete original, create new).
- Same rules apply when returning items to inbox.
