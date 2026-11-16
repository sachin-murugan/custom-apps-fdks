# FS Field Edit History (Freshworks CRM app)

Exports Freshsales history to CSV.

| Opened on | Exports |
|---|---|
| A contact, account or deal (the app menu on the record) | That record's field edit history, or its activity timeline |
| The full-page app, with a **list view** address or a picked view | Field edit history of every record in the view |
| The full-page app, with a **record** address | That record's field edit history, or its activity timeline |
| The full-page app, with a **workflow** address | The workflow's action history (every action it ran) |

Every export takes an optional **From** / **To** time; leave both blank for all history.
Field history also lets you untick fields; the list shows every field that has change
tracking on in the account.

Field history CSV, one row per change: Record ID, Record name, Field, Field key, Old value,
New value, Changed by, Source, Changed at.

Field history for a view needs one request per record, about 45 records a minute. Progress
is saved in the browser; if a run fails or is cancelled, export again with the same
settings and it continues (kept for 24 hours).

Ported from the [fs-field-edit-history](https://github.com/sachin-murugan/fs-field-edit-history)
Chrome extension; `app/scripts/lib/` is that extension's code, with edits only to satisfy `fdk validate`'s lint rules.

## Settings

| Setting | Value |
|---|---|
| Freshsales domain | `yourcompany.myfreshworks.com` or your custom domain (with or without `https://`) |
| Freshsales API key | Profile picture > Settings > API settings. The export sees what this user can see. |

## To confirm on the first live run

- Confirmed on a live Freshworks CRM account (2026-11-16, through `fdk run`): field edit
  history, the activity timeline, tracked fields and the record lookup all accept the API
  key. Workflow action history and classic `freshsales.io` accounts are not yet confirmed.
- Confirmed: on a record, the app reads the record from
  `client.data.get("currentEntityInfo")`.
- Everything in the [list view exporter's list](../fs-list-view-exporter/README.md#to-confirm-on-the-first-live-run).
