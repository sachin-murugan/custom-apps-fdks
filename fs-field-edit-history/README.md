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
| Freshsales domain | `yourcompany.myfreshworks.com` or your custom domain, without `https://` |
| Freshsales API key | Profile picture > Settings > API settings. The export sees what this user can see. |

## To confirm on the first live run

This app carries the most risk of the three.

- Field edit history (`POST /crm/sales/<module>/<id>/field_history`), the activity timeline
  (`/timeline_feeds`), tracked fields (`/settings/<module>/forms`) and workflow history
  (`/workflow_automations/audit_logs`) are the web app's own screens' requests, not
  documented API endpoints. The extension calls them with the browser session and CSRF
  token. **Whether Freshsales accepts an API key on them is not confirmed.** If it doesn't,
  the app reports that the data may only be available to a logged-in browser session, and
  the Chrome extension remains the way to get it.
- On a record, the app reads the record from `client.data.get("currentEntityInfo")`. If
  that returns nothing the app falls back to asking for an address.
- Everything in the [list view exporter's list](../fs-list-view-exporter/README.md#to-confirm-on-the-first-live-run).
