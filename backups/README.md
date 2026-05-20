# Backups

Local-only folder for JSON backup files exported from the app via the
`↓ EXPORT BACKUP` button.

Contents are gitignored — **never committed**. The folder itself is tracked
(via this README) so it exists after a fresh clone.

## Why local-only

The backup JSONs contain guest names and personality descriptions. This is a
public repo, so committing them would leak personal info about your friends.

## Workflow

- Export from the app → save here as `eki-greetings-backup-YYYY-MM-DDTHH-MM-SS.json`
- Keep the most recent before any major change
- Optionally sync this folder via iCloud Drive / Dropbox / etc for off-machine redundancy
- To restore: open the app → `↑ IMPORT BACKUP` → pick the file
