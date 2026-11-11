# AiTalk Assembled Work App — Guide

Version: 1

An **assembled work app** is a work app built from ready-made blocks — no code, no build. You describe it as an **app spec** (JSON). The server checks it, creates the tables and runs the app: the team works in it on the AiTalk app screen and with its AI chat.

Block list, column kinds and limits: **aitalk://block-catalog** (or `list_work_blocks`) — rendered from the same source the validator uses.

## Flow

1. `list_agents` → pick the agent.
2. `list_work_blocks` → see what you can use.
3. Write the spec. `validate_work_app_spec({ spec })` until it returns `ok: true`. Every problem comes with `path`, `code` and `message` — fix them all.
4. `create_work_app({ agentId, spec })` → `workAppId`, `workflowId`, `version: 1`, `appUrl`. The app is open for the team at once (it has no customer channel). Plan limits on workflows apply. Give `appUrl` to the owner.
5. Rows are added in the app (screen, file upload, its AI chat) — **not** over MCP.
6. To change the app: `get_work_app_spec({ workAppId })` → edit the spec → `update_work_app_spec({ workAppId, spec, expectedVersion: version })`.
   - **No rows yet** → applied at once (`applied: true`, new `version`).
   - **Rows exist** → nothing changes; you get `confirmationUrl`. Send it to the account owner: they open it while logged in, see the list of changes and press **Apply**. Single use, ~15 minutes. If the app changes first, ask again.
   - `dryRun: true` → checks everything, saves nothing, makes no link (`needsConfirmation` tells you whether a link would be needed).
   - `SPEC_INVALID` with issue code `STALE` → someone changed the spec; `currentVersion` is in the answer — read again and redo your change on top.

## Rules that never change

- **Keys** (`tables[].key`, `columns[].key`, alerts, sends) are `^[a-z][a-z0-9_]{0,39}$`. Once saved, a key is **permanent**: you cannot rename it, and a hidden key cannot be reused. Labels (`label`, `name`) can change freely. Computed columns are the exception to these rules — they store nothing, so they can be removed or changed.
- **Removing = hiding.** To drop a table or column set `"hidden": true` — rows keep their data.
- A column's `kind` never changes — nor the table a `ref` column points to (`ref.show` may change). A new column in an existing table cannot be `required`. Choice options can only be added; a money column's currency list can only grow — a money column saved without a list (any currency) cannot get one later. Status values in use cannot be removed. The number format (prefix, year, digits) cannot change.
- **Tables that point to each other** (items ↔ stock moves, equipment ↔ loans): a `ref` column `{ "kind": "ref", "ref": { "table": "items", "show": "name" } }` stores the id of one row of another table of this app; people see its `show` column. A row others point to cannot be deleted. Required refs must not go round in a circle. Sums can group by a ref column (`"by": "column:item"`).
- **A table of another assembled app** (orders → customers app): add `"app": "<its workAppId>"` to `ref` — `{ "kind": "ref", "ref": { "app": "<workAppId>", "table": "customers", "show": "name" } }`. Order: (1) draw a **reference line** on the canvas from the other app to this one, tick that table, deploy (2) then save the spec. Rows can pick only rows the line lets this app read (only confirmed rows unless the line includes unconfirmed data). The other app's rows are **not** protected from deletion — a picked row that was deleted, is not confirmed, or can no longer be read (line removed, table hidden) shows as such; other columns of the row can still be changed. The other app cannot hide that table or the `show` column while a live column here reads it. Required refs must not go round in a circle across apps either.
- **Sending a row on to another assembled app** (order → shipping): add `appSends` at the top of the spec — `{ "key": "to_shipping", "label": "Send to shipping", "table": "orders", "to": { "app": "<workAppId>", "table": "shipments" }, "map": { "<column of shipments>": "<column of orders, or number / status>" }, "allowWhen"?: { "status": ["confirmed"], "confirmed": true } }`. Order: (1) draw a **send line** on the canvas from this app to the other one, choose that table as its inbox, deploy (2) then save the spec. Every required column of the other table must be in `map`; no person, ref or computed columns; kinds must fit (same kind, or into longtext from text/choice/the row `number`, into text from choice/the row `number`/status, into choice from text — `number` here is the number block, not a number column). A person presses the row's button (or the AI calls `assembled_send`), sees a card with the values and presses send — the other app gets a NEW unconfirmed row in its start status with its number. **Each row goes once per send.** Usually set `"confirmed": true` so only checked rows move on. A send is never removed — set `"hidden": true`; its `table` cannot change. The other app cannot hide that table or a mapped column while a live send here uses it.
- **The company's own database** (stock in the ERP, orders in a shop database): add `companyDb` at the top of the spec — `{ "label": "ERP", "mode": "rows", "about": "Products are in items (sku, name, price, stock)." }` — use `"mode": "read"` when the app only reads; leaving `mode` out means `rows` (changes). A person must also, in the studio, pick the connection in the Start (App) node slot **Company database** and tick «Let the AI write SQL» — you cannot do that over MCP. Then the app's AI reads with SQL at once and proposes changes as cards. `mode`: `read` = reading only · `rows` (default) = one plain INSERT / UPDATE / DELETE on PostgreSQL or MySQL; the AI also writes a `SELECT COUNT(*)` and the person sees «about N rows will change» before confirming — if the real number differs, nothing is kept · `schema` = also tables (red confirmation, no count). SQL Server: `read` or `schema` only. `about` is guidance for the AI, not a permission — limit the database user itself.
<!-- cloud-only -->
- **Looking things up** (company rules in uploaded documents · a web page a person names · the web): add `lookup` at the top of the spec — `{ "docs": true, "webPages": true }` (each one separately; at least one). `docs` = the agent's uploaded documents (a person picks the document space on the Start (App) node in the studio). `webPages` = a page whose address a person wrote in the chat. `webSearch` = the web (Microsoft Bing — the search words leave Switzerland and the Azure data protection terms; each search costs 2 Credits and one question usually costs about 8–13 Credits) — prefer `webPages` for apps with customer data and turn `webSearch` on only when the app needs it. A person can switch the web off for one work app (Sending tab).
<!-- /cloud-only -->
<!-- selfhosted-only -->
- **Looking things up** (company rules in uploaded documents · a web page a person names · the web): add `lookup` at the top of the spec — `{ "docs": true, "webPages": true }` (each one separately; at least one). `docs` = the agent's uploaded documents (a person picks the document space on the Start (App) node in the studio). `webPages` = a page whose address a person wrote in the chat. `webSearch` = the web (Microsoft Bing — works only when this installation's AI connection is Azure OpenAI with Bing search; otherwise the AI has no web search tool; the search words leave your server) — prefer `webPages` for apps with customer data and turn `webSearch` on only when the app needs it. A person can switch the web off for one work app (Sending tab).
<!-- /selfhosted-only -->
<!-- cloud-only -->
- **Telling the team in Telegram** (new request · status changed · a date is near): add a send with `"via": "telegram", "to": "team", "body": "<text with {column} placeholders>"` and name it in a date alert or move alert as `"telegram": "<send key>"` — the message then goes out on its own to the app's ONE team chat (an unconfirmed row sends only the alert name, number and status). The owner sets the bot and the chat on the Start / App node in the studio — you cannot. The text leaves Switzerland (Telegram servers): put only columns the team may see there. Plain text, the body template at most 4000 characters.
<!-- /cloud-only -->
<!-- selfhosted-only -->
- **Telling the team in Telegram** (new request · status changed · a date is near): add a send with `"via": "telegram", "to": "team", "body": "<text with {column} placeholders>"` and name it in a date alert or move alert as `"telegram": "<send key>"` — the message then goes out on its own to the app's ONE team chat (an unconfirmed row sends only the alert name, number and status). The owner sets the bot and the chat on the Start / App node in the studio — you cannot. The text leaves your server (Telegram servers): put only columns the team may see there. Plain text, the body template at most 4000 characters.
<!-- /selfhosted-only -->
- **Sending a row to another system** (ERP · Zapier · Make · own server): add a send with `"via": "http", "to": "api"` and `"map": { "<key the other system gets>": "<column key, or number, or status>" }` (no subject or body) — `allowWhen` may add `"confirmed": true`. A person presses the row button (or the AI makes the card with `assembled_mail`) and then **Send** — never on its own and not from alerts. The address and authentication are set by the **owner in Agent Studio** (Start / App node, slot "HTTP" — a fixed https address and a test button); you cannot set, change or see the address. Tell the owner to set it.
<!-- cloud-only -->
- **Putting a row into a calendar** (visits · bookings · deadlines in Google or Outlook): add a send with `"via": "calendar", "to": "cal", "subject": "<event title with {column} placeholders>", "body"?: "<description>", "event": { "date": "<date column>", "start"?: "<time column>", "end"?: "<time column>" }` (`minutes` instead of `end`; no `start` = all-day; `endDate` = several days) — `allowWhen` may add `"confirmed": true`. A person presses the row button (or the AI makes the card with `assembled_mail`) and then **Send**; one row = one event, never twice. The calendar is picked by the **owner in Agent Studio** (Start / App node, slot "Calendar") from the agent's Google or Microsoft connection — made once in a workflow Calendar node; you cannot pick it. Suggest a shared team calendar so the whole team sees the events.
<!-- /cloud-only -->
<!-- cloud-only -->
- **Texting the customer of a row** (repair ready · booking confirmed · pick-up): add a send with `"via": "sms", "to": "column:<text column with the phone number>", "body": "<the text with {column} placeholders, at most 459 characters>"` — `allowWhen` may add `"confirmed": true`. Only **mobile numbers in Switzerland, Germany and France**; a number without a country code (`079 …`) is taken as Swiss, so ask for `+49` / `+33` on German / French numbers (an intake `identify` by phone already stores `+41 …`). The customer sees the sender «AiTalk ch» and **cannot reply** — start the text with the company name and give a phone or address. Costs Credits per SMS part (Switzerland 12 · Germany 14 · France 15; a part = 160 characters, or 70 when the text has Korean, emoji, `ç ê â ô û` or the long dash `–`; at most 3 parts). A person presses the row button (or the AI makes the card with `assembled_mail`) and then **Send**; never from alerts. Not in self-hosted.
<!-- /cloud-only -->
- **Approvals that tell the next person** (leave · purchase): add `moveAlerts` to a table with a status block — `{ "key": "up", "label": "Submitted", "to": ["submitted"], "notify": "column:manager", "send": "ask_manager" }`. The moment a row moves into (or is created in) a `to` status, the team and the person in `notify` get one line; with `send` (same table, same person as `notify`, no `attachDoc`) an email card waits. For `send` and `telegram` alike, a send's `allowWhen.status` — if any — must include every `to` status. A date alert's `send` also cannot have `attachDoc`. The `notify` column can then be changed only by the owner or the person in it.
<!-- cloud-only -->
- **Customers who add rows** (repair requests · bookings · enquiries): add `intake` to a table — `{ "columns": [keys customers may fill], "identify"?: { "column": <text column in columns>, "by": "phone" }, "form"?: true }`. Only text, longtext, number, money, date, time, choice and yes/no columns; every required column must be listed; not on a hidden table. Rows arrive unconfirmed in the start status. Two ways in: a customer-facing workflow whose AI node has the work app inbox tool (`inboxFamily` = `app_<table key>`), and with `form: true` a public page link the owner makes above the table (no login, no AI, no Credits). Customers cannot read or change rows.
<!-- /cloud-only -->
<!-- selfhosted-only -->
- **Customers who add rows** (repair requests · bookings · enquiries): add `intake` to a table — `{ "columns": [keys customers may fill], "identify"?: { "column": <text column in columns>, "by": "phone" }, "form"?: true }`. Only text, longtext, number, money, date, time, choice and yes/no columns; every required column must be listed; not on a hidden table. Rows arrive unconfirmed in the start status. Two ways in: a customer-facing workflow whose AI node has the work app inbox tool (`inboxFamily` = `app_<table key>`), and with `form: true` a public page link the owner makes above the table (no login, no AI). Customers cannot read or change rows.
<!-- /selfhosted-only -->
<!-- cloud-only -->
- **Another system that adds rows** (online shop orders · form-service answers · Zapier / Make · the company's own program): add `"webhook"` to that table's `intake` — `true` takes a flat JSON of intake column keys; `{ "map": { <intake column>: "<dot path in the sender's JSON, e.g. billing.name>" }, "id"?: "<path of the sender's order id>" }` takes the sender's own JSON as it is. Every required intake column needs a path in `map`. Same rules as intake (unconfirmed · start status · no AI · no Credits · 60 rows an hour from outside per app); the same request id twice = one row. The owner makes the secret address with «Webhook» above the table and pastes it into the other system — you cannot see or set it.
<!-- /cloud-only -->
<!-- selfhosted-only -->
- **Another system that adds rows** (online shop orders · form-service answers · Zapier / Make · the company's own program): add `"webhook"` to that table's `intake` — `true` takes a flat JSON of intake column keys; `{ "map": { <intake column>: "<dot path in the sender's JSON, e.g. billing.name>" }, "id"?: "<path of the sender's order id>" }` takes the sender's own JSON as it is. Every required intake column needs a path in `map`. Same rules as intake (unconfirmed · start status · no AI · 60 rows an hour from outside per app); the same request id twice = one row. The owner makes the secret address with «Webhook» above the table and pastes it into the other system — you cannot see or set it.
<!-- /selfhosted-only -->
- `file`, `morefileids`, `status`, `number` are reserved column keys, and keys may not start with `docfile_` or `docfp_`. A money column `x` also uses `x_cur`.
- Text the people see (names, labels, mail subjects and bodies) lives in the spec. Write it in the language the team works in.
<!-- cloud-only -->
- The AI of the app never confirms rows — a person does. Mail, HTTP, calendar and SMS sends never go out by themselves — a card waits and a person presses send.
<!-- /cloud-only -->
<!-- selfhosted-only -->
- The AI of the app never confirms rows — a person does. Mail and HTTP sends never go out by themselves — a card waits and a person presses send. This installation has no SMS or calendar sends (they come in a later version) — a spec with `"via": "sms"` or `"via": "calendar"` is refused.
<!-- /selfhosted-only -->

## Example — contract renewals

```json
{
  "spec": 1,
  "name": "Contract renewals",
  "about": "Track supplier contracts. Read the contract PDF into the fields. Remind 30 days before expiry.",
  "tables": [{
    "key": "contracts",
    "name": "Contracts",
    "columns": [
      { "key": "supplier", "label": "Supplier", "kind": "text", "required": true },
      { "key": "amount", "label": "Amount", "kind": "money" },
      { "key": "start", "label": "Start", "kind": "date" },
      { "key": "end", "label": "Expiry", "kind": "date", "required": true },
      { "key": "owner", "label": "Owner", "kind": "person" },
      { "key": "auto", "label": "Auto-renew", "kind": "yesno" },
      { "key": "days_left", "label": "Days left", "kind": "computed", "block": "days_until", "from": "end" }
    ],
    "file": { "fill": ["supplier", "amount", "start", "end", "auto"] },
    "status": {
      "values": ["draft", "active", "renewing", "ended"],
      "start": "draft",
      "moves": [["draft", "active"], ["active", "renewing"], ["renewing", "active"], ["active", "ended"], ["renewing", "ended"]],
      "lockedIn": ["ended"]
    },
    "confirm": { "by": "column:owner" },
    "number": { "prefix": "CT-", "year": true, "digits": 3 },
    "alerts": [{ "key": "expiry30", "label": "Expires in 30 days", "date": "end", "daysBefore": 30, "when": { "status": ["active"] }, "to": "column:owner", "send": "renewal_mail" }]
  }],
  "sends": [{
    "key": "renewal_mail",
    "label": "Renewal reminder",
    "table": "contracts",
    "to": "column:owner",
    "subject": "Contract {number} with {supplier} expires on {end}",
    "body": "The contract {number} with {supplier} expires on {end} ({days_left} days left). Please decide whether to renew.",
    "allowWhen": { "column": "days_left", "max": 30 }
  }]
}
```

## Common refusals

| code | what to do |
|---|---|
| `REQUIRED` · `INVALID` · `BAD_KEY` · `BAD_KIND` | fix the value at `path` |
| `BAD_REF` | the field names a column / table / status / send that does not exist, is hidden, or has the wrong kind |
| `DUPLICATE` · `KEY_CLASH` | two things share a key or a name — rename one |
| `RESERVED` | choose another column key |
| `UNREACHABLE` · `DEAD_END` | every status must be reachable from `start`; a status with no move out must be in `lockedIn` |
| `TABLE_REMOVED` · `COLUMN_REMOVED` | keep it and set `"hidden": true` |
| `KIND_CHANGED` · `NUMBER_CHANGED` · `OPTION_REMOVED` · `STATUS_VALUE_IN_USE` · `START_IN_USE` · `NEW_REQUIRED` · `REQUIRED_ADDED` | the change would break existing rows — leave that part as it was |
| `REF_TABLE_CHANGED` | a ref column keeps its table — add a new ref column instead |
| `REF_CYCLE` | make one of the required ref columns in the circle optional |
| `NO_LINE` | draw the reference line from the other app to this one on the canvas, tick the table, deploy — then save again |
| `REF_IN_USE` | another app reads this table (or its `show` column) — hide that column there first |
| `TAKEN` | a sheet with that table key already exists in the app — choose another key |
| `STALE` | read the spec again (`currentVersion`) and redo the change |
| `TOO_MANY` · `TOO_LONG` · `TOO_LARGE` | stay within the limits in the block catalog |

## Not over MCP

Adding, editing or deleting rows · deleting an app (dashboard) · team members and mail connections (dashboard / app settings).
