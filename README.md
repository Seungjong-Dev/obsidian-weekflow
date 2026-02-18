# WeekFlow

Weekly timetable-based time management and review plugin for [Obsidian](https://obsidian.md).

## What is WeekFlow?

WeekFlow turns your daily notes into a visual weekly timetable. Plan your week, track what you actually did, and review it all in one view.

- **Plan** — outline blocks represent scheduled tasks (`- [ ]`)
- **Actual** — filled blocks represent completed work (`- [x]`)
- **Review** — free-text daily reflections below the timetable

```
Plan (계획)  ──▶  Actual (실행)  ──▶  Review (회고)
    ▲                                      │
    └──────────── next week planning ──────┘
```

## Features

### Timetable View
- 7-day weekly grid with 10-minute cell resolution (5-minute precision for data)
- Plan blocks (outline) and Actual blocks (fill) displayed simultaneously
- Drag to create, click to edit, right-click for context menu
- Block drag-move (same day & cross-day), boundary resize, completion toggle
- Undo/Redo for all block operations

### Planning Panel
- **Overdue** — uncompleted past items collected in one place
- **Inbox** — tasks from a configurable inbox note, drag onto the timetable to schedule
- **Projects** — tasks from project notes via Obsidian's `metadataCache`, drag to schedule with auto `[[Project#^block-id]]` linking
- **Deferred** — moving past-date plans marks them as `- [>]` with full traceability
- **Presets** — save and apply time slot templates across days

### Review & Statistics
- Daily review panel aligned with timetable columns (inline textarea, auto-saved)
- Statistics view: category/project time breakdown, plan vs actual comparison, burning rate chart, time distribution
- Multiple ranges: weekly, monthly, quarterly, yearly

### Calendar Overlay
- ICS URL subscription (Google Calendar, Outlook, etc.)
- Read-only overlay displayed behind timetable blocks
- Async loading with in-memory cache and offline fallback

### Responsive & Mobile
- Width-based 3-tier layout: **Wide** (7 days) / **Medium** (3 days) / **Narrow** (1 day)
- Touch: tap-tap cell selection, swipe navigation, longpress block drag
- Apple Pencil: drag selection like mouse
- Adapts to desktop resize, iPad Split View, iPhone portrait/landscape

## Data Format

WeekFlow reads and writes standard markdown checkbox lists under a configurable heading in your daily notes. No proprietary data store — your data stays in plain text.

```markdown
## Timeline
- [ ] 09:00-11:00 API design #work
- [x] 09:00-11:00 > 09:15-10:45 API design #work
- [>] 14:00-15:00 Review PR #work
```

- `- [ ]` Plan | `- [x]` Actual | `- [>]` Deferred
- `HH:MM-HH:MM` plan time, `> HH:MM-HH:MM` actual time
- Tags, [Tasks plugin](https://github.com/obsidian-tasks-group/obsidian-tasks) metadata, and block references are preserved verbatim

## Installation

### From Obsidian Community Plugins (coming soon)

1. Open **Settings → Community Plugins → Browse**
2. Search for "WeekFlow"
3. Install and enable

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/user/obsidian-weekflow/releases)
2. Create a folder: `<vault>/.obsidian/plugins/weekflow/`
3. Place the three files inside
4. Enable the plugin in **Settings → Community Plugins**

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| Daily Note Path | moment.js path pattern | `YYYY/MM/YYYY-MM-DD` |
| Timeline Heading | Heading to parse items under | `## Timeline` |
| Day Start / End Hour | Visible hour range | 6 – 24 |
| Week Start Day | 0=Sun, 1=Mon, ... | 1 (Monday) |
| Categories | Tag, label, and color | Work, Personal |
| Inbox Note Path | Inbox note path pattern | `YYYY-[W]ww` |
| Review Heading | Heading for review text | `## Review` |
| Calendar Sources | ICS URLs with color/enable | — |

See the full settings in the plugin's settings tab.

## Commands

| Command | Description |
|---------|-------------|
| Open weekly view | Open the WeekFlow timetable |
| Open statistics | Open the statistics panel |
| Go to this week | Navigate to the current week |
| Undo / Redo | Undo or redo the last action |
| Toggle planning panel | Show or hide the planning sidebar |

## Development

```bash
npm install
npm run dev     # development build with hot reload
npm run build   # production build
```

For testing, symlink or copy the repo into your vault's `.obsidian/plugins/weekflow/` directory.

## License

[MIT](LICENSE)
