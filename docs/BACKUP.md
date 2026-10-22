# Backups, restore and export

Everything CODEX.EXE knows lives in one SQLite database plus your attached images:

| | Installed app | Portable exe |
|---|---|---|
| Data folder | `%APPDATA%\dev.tommy.codex` | `CODEX-data` next to the exe |
| Database | `codex.sqlite3` | same |
| Images | `attachments\`, `maps\` | same |
| Automatic snapshots | `backups\` | same |

The exact path is shown in **Settings → Data & backups**.

## Automatic snapshots

Once a day (the first time you open the app) CODEX saves a complete copy of the database to
`backups\`. The newest 20 are kept. From **Settings → Data & backups → Automatic snapshots** you
can take one now or restore any of them. Restoring first saves a snapshot of your current data,
so a restore can always be undone.

## Full backup (move to another PC, keep a safe copy)

**Settings → Data & backups → Backups → Back up everything** asks for a folder and writes
`CODEX backup <date>\` containing:

- `codex-backup.json` — every character, note, quest, person, marker, dungeon, route, reminder
  and session (plain JSON, readable in any text editor);
- `files\attachments\`, `files\maps\` — your screenshots and imported map images.

**Restore from backup** reads such a folder, checks it, takes a safety snapshot, then replaces
the current data. Only image files are copied back, and only into the data folder.

## Export your adventure journal

**Settings → Data & backups → Export adventure journal** writes a Markdown file for the current
character (quests, people, places, discoveries, diary, timeline, notes) and copies the images it
uses into an `attachments` folder beside it. Markdown opens in any editor and converts to PDF or
Word with common tools.

## What is never touched

Backups and restores only ever read or write CODEX's own data folder and the folders you pick.
Game folders and save games are never part of a backup or restore.
