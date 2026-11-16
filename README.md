# custom-apps-fdks

Freshworks CRM (Freshsales) marketplace apps, built with the Freshworks Developer Kit on
platform version 3.0 (global apps). Each folder is one self-contained FDK app, ported from
the Chrome extension of the same name.

| Folder | What it exports | Where it shows up in Freshsales |
|---|---|---|
| [`fs-list-view-exporter`](fs-list-view-exporter) | Every record of a saved list view, to CSV | Full-page app (left navigation) |
| [`fs-data-exporter-all`](fs-data-exporter-all) | List views, plus account data: users, marketing lists and their contacts, sequences, workflows, reports list, tasks, meetings, sales activities | Full-page app |
| [`fs-field-edit-history`](fs-field-edit-history) | Field edit history of a list view or record, a record's activity timeline, a workflow's action history | Full-page app, and the app menu on a contact, account or deal |

## How the apps differ from the extensions

The extensions run inside your logged-in Freshsales tab and use your session cookie. A
marketplace app runs in an iframe on Freshworks' app domain, so it has no access to that
session. Instead:

- **Sign-in**: at install time each app asks for a Freshsales API key
  (`config/iparams.json`). The key is stored by the platform as a secure parameter and is
  never sent to the browser. The account's address comes from the platform
  (`current_host.endpoint_urls`), so there is no domain to type.
- **Requests**: every call goes through the platform's Request Method
  (`config/requests.json`, `app/scripts/bridge.js`). The exporter code in
  `app/scripts/lib/` is the extension's code (edited only to pass the CLI's lint rules); `bridge.js` gives it a `fetch`
  that calls `client.request.invokeTemplate`.
- **Speed**: the platform allows 50 Request Method calls a minute per installation. The
  apps send requests as fast as they can until 45 have gone out in the last minute, then
  pause until the window frees up (the progress screen says so). A small export finishes
  at full speed; a list view exports up to about 4,500 records a minute (100 per request).
  Anything that needs one request per record (full details, field history) runs at about
  45 records a minute. Lookup lists are fetched only for the module being exported and
  are remembered for an hour.
- **Progress**: an export switches the page to a progress screen with the record count,
  a progress bar, the time elapsed and an estimate of the time left, and a Cancel button.
- **Picking the page**: an app can't see which Freshsales page is open (except on a
  record's app menu), so you paste the page address or pick the module and view.

## Download and install

Ready-to-upload zips are in [`zips/`](zips), built with `fdk pack` from this commit:

- [`fs-list-view-exporter.zip`](zips/fs-list-view-exporter.zip)
- [`fs-data-exporter-all.zip`](zips/fs-data-exporter-all.zip)
- [`fs-field-edit-history.zip`](zips/fs-field-edit-history.zip)

1. Download the zip (open it on GitHub and click **Download raw file**).
2. In the [Freshworks developer portal](https://developers.freshworks.com/), create a
   **Custom app** and upload the zip, then publish it to your account.
3. In Freshsales open **Admin settings > Marketplace apps**, find the app under custom apps,
   click **Install**, and paste your API key (profile picture > **Settings > API settings**).

## Build the zips yourself

You need the Freshworks CLI (`fdk`), see
<https://developers.freshworks.com/docs/app-sdk/v3.0/common/app-development-process/>.
The manifests are set to the versions the apps were validated with: FDK 9.8.2 on Node.js
18.20.8. With FDK 10 (Node.js 24.11+), let `fdk validate` update `engines` when it asks.

```bash
cd fs-list-view-exporter      # or another app folder
fdk validate
fdk pack -s                   # skip the coverage gate; writes dist/<folder>.zip
```

Then upload it as above. After changing an app, rebuild its zip and copy it into `zips/`.

Full-page apps can't be previewed with `fdk run`; Freshworks requires publishing them as a
custom app to try them.

## Status

- Each app is checked headlessly against a mock Freshsales account
  (`node tools/smoke-test.js`, needs Playwright).
- All three were tested live on 2026-11-17 in dev mode (`fdk run` + `?dev=true`) on a
  myfreshworks.com account: list views of 1,164 contacts and 874 deals, marketing list
  members, workflows, users, field edit history and timelines. Classic freshsales.io
  accounts are not tested yet.
- Segments, email campaigns and journeys are not offered: Freshworks' marketing API does
  not accept API keys. The Chrome extension still exports them.
