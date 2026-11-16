# FS List View Exporter (Freshworks CRM app)

Exports every record of a saved list view to CSV: Contacts, Accounts, Deals, Leads (classic
Freshsales), Products, CPQ documents and custom modules.

1. Open the app from the left navigation.
2. Paste the list view's address (for example
   `https://yourcompany.myfreshworks.com/crm/sales/contacts/view/123`), or pick the module
   and saved view.
3. Click **Export to CSV**. You can choose the columns before the file is saved; the choice
   is remembered per module.

Options: **Load full details for every record** merges each record's detail API response
into its row. It needs one request per record, so it runs at about 45 records a minute.

Ported from the [fs-list-view-exporter](https://github.com/sachin-murugan/fs-list-view-exporter)
Chrome extension; `app/scripts/lib/` is that extension's code, with edits only to satisfy `fdk validate`'s lint rules.

## Settings

| Setting | Value |
|---|---|
| Freshsales domain | `yourcompany.myfreshworks.com`, `yourcompany.freshsales.io` or your custom domain, without `https://` |
| Freshsales API key | Profile picture > Settings > API settings. The export sees what this user can see. |

## Files

```
manifest.json            platform 3.0; full_page_app; contact, deal, sales_account modules
config/iparams.json      installation settings (domain, API key)
config/requests.json     the crmGet request template
app/index.html           the page
app/scripts/app.js       export flow
app/scripts/views.js     list view picker
app/scripts/bridge.js    Request Method transport, request pacing, storage
app/scripts/ui.js        progress, errors, download
app/scripts/lib/         exporter code from the extension
```

## To confirm on the first live run

- The request template passes the whole path, including the query string, as
  `<%= context.path %>`. If Freshsales answers as though `page` / `per_page` were missing,
  the platform is encoding the `?`; the query would then need to move into the template's
  `query` block.
- The CSV download starts from inside the app iframe. If the browser blocks it, the
  **Download …** link under the progress bar saves the same file.
