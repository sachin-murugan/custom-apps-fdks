# FS Data Exporter (Freshworks CRM app)

Exports Freshsales data to CSV from one page.

**A list view**: paste its address or pick the module and saved view. Works for Contacts,
Accounts, Deals, Leads (classic), Products, CPQ documents and custom modules.

**Account data**, from the *What to export* list:

| Export | Notes |
|---|---|
| All users | |
| All marketing lists | |
| All sales sequences | |
| All workflows | |
| All reports (list) | the list of custom reports, not their contents; needs a plan with custom reports |
| All tasks, meetings, sales activities | |

**One item**: paste its page address to add these to the list:

| Page | Export |
|---|---|
| Marketing list (`/contacts/list/<id>`) | Contacts in this list |
| Sales sequence | Contacts in this sequence |
| Email conversations folder | Emails in this folder |

Progress is saved in the browser page by page. If an export fails or is cancelled, run it
again and it continues where it stopped (kept for 24 hours).

Ported from the [fs-data-exporter-all](https://github.com/sachin-murugan/fs-data-exporter-all)
Chrome extension; `app/scripts/lib/` is that extension's code, with edits only to satisfy `fdk validate`'s lint rules.

## Not available in the app

- **A report's table** and **Suite analytics reports**. The extension reads these from the
  open page and from the analytics app's own session; an app can reach neither.
- **Segments, email / transactional / social campaigns and journeys**. These live in the
  marketing app (`/crm/marketer/...`), which answers an API key with its sign-in page
  (checked live on 2026-11-17). Use the Chrome extension for them.

## Settings

| Setting | Value |
|---|---|
| Freshsales API key | Profile picture > Settings > API settings. The export sees what this user can see. |

## To confirm on the first live run

- Everything in the [list view exporter's list](../fs-list-view-exporter/README.md#to-confirm-on-the-first-live-run).
- The exports marked *marketer app* call `/crm/marketer/...`, which the extension reaches
  with the browser session. Whether those endpoints accept an API key is not confirmed; if
  they don't, the app says the export couldn't be reached with the API key.
- Sequences, workflows, reports list and email conversations use the same `/crm/sales/api`
  paths as the web app. They are expected to accept the API key but have only been run
  with a session so far.
