# custom_apps

Freshworks CRM (Freshsales) marketplace apps, built with the Freshworks Developer Kit on
platform version 3.0 (global apps). Each folder is one self-contained FDK app, ported from
the Chrome extension of the same name.

| Folder | What it exports | Where it shows up in Freshsales |
|---|---|---|
| [`fs-list-view-exporter`](fs-list-view-exporter) | Every record of a saved list view, to CSV | Full-page app (left navigation) |
| [`fs-data-exporter-all`](fs-data-exporter-all) | List views, plus account data: users, marketing lists and their contacts, segments, sequences, workflows, reports list, campaigns, journeys, tasks, meetings, sales activities | Full-page app |
| [`fs-field-edit-history`](fs-field-edit-history) | Field edit history of a list view or record, a record's activity timeline, a workflow's action history | Full-page app, and the app menu on a contact, account or deal |

## How the apps differ from the extensions

The extensions run inside your logged-in Freshsales tab and use your session cookie. A
marketplace app runs in an iframe on Freshworks' app domain, so it has no access to that
session. Instead:

- **Sign-in**: at install time each app asks for the Freshsales domain and an API key
  (`config/iparams.json`). The key is stored by the platform as a secure parameter and is
  never sent to the browser.
- **Requests**: every call goes through the platform's Request Method
  (`config/requests.json`, `app/scripts/bridge.js`). The exporter code in
  `app/scripts/lib/` is the extension's code, unchanged; `bridge.js` gives it a `fetch`
  that calls `client.request.invokeTemplate`.
- **Speed**: the platform allows 50 Request Method calls a minute per installation, so the
  apps space requests 1.3 s apart. A list view still exports at about 4,500 records a
  minute (100 per request). Anything that needs one request per record (full details,
  field history) runs at about 45 records a minute.
- **Picking the page**: an app can't see which Freshsales page is open (except on a
  record's app menu), so you paste the page address or pick the module and view.

## Install as a custom app

You need Node.js 24.11+ and the Freshworks CLI (`fdk`) 10+.
See <https://developers.freshworks.com/docs/app-sdk/v3.0/common/app-development-process/>.

```bash
cd fs-list-view-exporter      # or another app folder
fdk validate
fdk pack --skip-coverage      # writes dist/<folder>.zip
```

Then in the [Freshworks developer portal](https://developers.freshworks.com/) create a
**Custom app**, upload the zip and publish it to your account. In Freshsales open
**Admin settings > Marketplace apps**, install it, and enter your domain and API key
(profile picture > **Settings > API settings**).

Full-page apps can't be previewed with `fdk run`; Freshworks requires publishing them as a
custom app to try them.

## Status

- Each app is checked headlessly against a mock Freshsales account
  (`node tools/smoke-test.js`, needs Playwright).
- None of them has been installed on a live Freshsales account yet. Things to confirm on
  the first live run are listed in each app's README.
