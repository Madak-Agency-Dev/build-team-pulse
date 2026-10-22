# Build Team Pulse

Daily dashboard for the Madak build team (Blair, David, Jamie): standup commitments and how they landed, plus live Asana activity.

## How it works

- `public/index.html` — the dashboard page. `public/dash-shim.js` runs its data layer in the browser.
- `api/asana.js` — proxies Asana task search using `ASANA_TOKEN`. Only task search in the Madak workspace is allowed.
- `api/data.js` — serves `data/commitments.json` and `data/reminders.json` to signed-in viewers. These files are not public.
- `api/login.js`, `api/session.js` — shared team password, kept in a 30-day signed cookie.

## Environment variables (Vercel → Settings → Environment Variables)

| Key | What |
|---|---|
| `TEAM_PASSWORD` | The shared sign-in password. Changing it signs everyone out. |
| `ASANA_TOKEN` | An Asana personal access token. Everyone sees what this account can see. |
| `ASANA_WORKSPACE` | Madak workspace GID, `1115873901271629`. |

Redeploy after changing any of them.

## Updating standup data

`/standup` (or Claude, on request) edits `data/commitments.json` and `data/reminders.json` and commits to `main`. Vercel redeploys in about a minute.

Commitment row: `{ id, standup_date, person, commitment, project, status, evidence, checked_on }`. Status is one of `pending`, `done`, `handoff`, `progress`, `waiting`, `missed`.
