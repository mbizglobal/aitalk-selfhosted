# Build a Work App

This guide takes you from an installed AI Talk Self-hosted to your own Work App, running in your installation.
It follows the example app in [`src/work-apps/example/`](src/work-apps/example/) — an expense list with a monthly
total — one file at a time. Copy it, rename it, change it.

## Rules for coding agents

If you are a coding agent building a Work App for a person, follow these rules. They keep the person's installation
and data safe, and keep their app working after our updates.

**What you may change**
- Only the app's folder `src/work-apps/<id>/` and one line each in `src/work-apps/custom.ts` and
  `src/work-apps/custom-meta.ts`. Do not change the core — anything else under `src/`, `prisma/`, `docker/`, the
  `Dockerfile` or `package.json`. Our updates replace those files.
- From the core, import only `@/lib/work/package-api`. Your app's own files may import each other. Two exceptions,
  as in the example: your tests may import `composeWorkApps` from `@/lib/work/registry`, and the two list files import
  the types from `@/lib/work/package` and `@/lib/work/package-meta` (step 2).
- The app reaches outside only through what it declares in `uses` — `ctx.send`, `ctx.db`, `ctx.knowledge`, … (see
  [Work SDK 0.3](#what-your-app-can-use-work-sdk-03)). No `fetch`, no files on the server, no other programs.
- Screens come from declarations (sheet templates, `ui.*`); an app has no pages or HTTP routes of its own.
- Write `core:` as a number (`core: 3`), never the constant `WORK_APP_CORE_API`.
- If the contract has no way to do what the person needs, **stop and tell them what is missing**. Do not work around
  it by changing the core.
- When you are done, `npm test` must pass. Build the image with this repository's `Dockerfile` and `package.json` as
  they are — the `Dockerfile` limits the build to two workers so that a Docker VM with 8 GB of memory is enough.

**The person's installation**
- There are three places on their computer: this source folder, the **install folder** (`docker-compose.yml` and
  `.env`, made apart from the repository — README, *Install with Docker*) and Docker's storage (database and files).
  Find the install folder with `docker compose ls` before you ask for it.
- In the install folder, change only the `AITALK_IMAGE` line of `.env`. **Never read or print the secrets in `.env`**
  (`ENCRYPTION_SECRET`, `NEXTAUTH_SECRET`, passwords): what you print stays in the chat history, and without
  `ENCRYPTION_SECRET` the saved AI keys and passwords cannot be read. Change the line without opening the file, and
  show only that line — put the tag of the image you just built (step 4) or the published image of the new version in
  place of `<image>`:
  `sed -i.bak 's|^AITALK_IMAGE=.*|AITALK_IMAGE=<image>|' .env && grep '^AITALK_IMAGE=' .env`
  (the same command works on Linux and macOS). `.env.bak` is the old file — with the same secrets, so do not print it
  either. If the app does not start with the new image, stop and tell the person — do not just switch the image back:
  the new version may already have changed the database on start, and the old image may not run on it. Only the
  backup you made brings the database back, so go back together with it: `mv .env.bak .env`, restore that backup
  (README, *Upgrades and backups*), then start.
- Whichever way it ends — the new image runs, or you went back with the backup — delete `.env.bak` once the app runs.
- Back up the database before every restart with a new image (README, *Upgrades and backups*). Never touch Docker's
  volumes directly.

**Working with the person** — assume they have never done this before.
- First check what is needed: git, Node.js 22, Docker Desktop (with at least 8 GB of memory for it), and on Windows
  WSL2. If something is missing, guide the installation one step at a time.
- Say in plain words what you are doing and why. Do one step at a time.
- Ask before every step that changes their running installation: the backup, switching the image, the restart.
- At the end, tell them what to open and click in the browser to see that the app works.

## What a Work App is

A Work App is one folder in `src/work-apps/<id>/`. Your team opens it like a team chat: the AI does the work in the
app's sheets, people answer and confirm, and each period (a month, a quarter) is closed with a sealed calculation.

| You write | The core does |
|---|---|
| **Sheet templates** — the columns of your tables | Stores the rows (encrypted columns if you ask), draws the table, row editor, confirm buttons |
| **An app template** — which sheets, which modules, the AI's instructions, how periods work | Creates the sheets, the tasks (periods), the chat, the screens |
| **Modules** — a calculation that is sealed when a period is closed, and actions (import a file, check something) | Runs them for people and for the AI, logs who did what, locks closed periods |
| **AI tools** (optional) — functions only your app's AI can call | Gives the AI the shared tools (read and write rows, read files, run modules, propose notes) |
| **Uses** (optional) — what your app reaches outside: email, Telegram, a web service, your documents, web search, your company database, an inbox for customer requests | Asks a person before anything leaves (a card with **Send**), keeps the keys, logs every send and every database read |
| **Texts** — English is enough | Shows them in the user's language when you add translations, in English otherwise |

The rules people rely on are enforced by the core, not by your code: rows written by the AI or by a module stay
**unconfirmed** until a person confirms them (your template may let the AI confirm rows it is sure about, with a
written reason); when a calculation column of a confirmed row changes, the row must be confirmed again; the AI can
delete only rows it added itself that nobody else touched; a closed period is **locked**; a period can only be closed
when every row in it is confirmed.

> **First check whether you need code at all.** Many team apps (requests, bookings, repairs, renewals, stock, approvals)
> fit the ready-made blocks of an **assembled app**: tables, status, numbers, totals, reminders, mail, Telegram, HTTP to
> another system, customer intake, a webhook, PDF documents, the company database. Then you write no folder and build
> no image — connect to the installation's MCP server and assemble the app with `create_work_app` (read the resource
> `aitalk://work-app-guide` first). See *Assembled apps over MCP* in the [README](README.md#assembled-apps-over-mcp).
> Write a Work App folder (this guide) when the app needs its own calculation, a sealed period close or its own AI tools.

## Before you start

- AI Talk Self-hosted installed with Docker as in the [README](README.md), and an AI connection added.
- This repository on the machine where you build the image, with Node.js 22 (`npm ci` once).
- Work on your own branch or fork, so you can take our updates later (see [Upgrades](#upgrading-ai-talk)).

## 1. Copy the example

```bash
cp -r src/work-apps/example src/work-apps/acme
```

Pick an id: lowercase letters, digits and `-`, starting with a letter (`acme`, `acme-travel`). It is the folder
name and the start of **every name** in your app. Not allowed: `work`, `vat`, `bank`, and an id that is another
app's id plus `-…` (`acme` and `acme-x` cannot both exist).

Replace `example` with your id everywhere in the new folder (works on Linux and macOS):

```bash
( cd src/work-apps/acme \
  && mv example.test.ts acme.test.ts \
  && find . -type f -name '*.ts' -exec sed -i.bak 's/example/acme/g; s/Example/Acme/g' {} + \
  && find . -name '*.bak' -delete )
```

Run it from the repository folder; it stops at the first step that fails.

This changes:

| Where | What |
|---|---|
| `index.ts` | `id: 'acme'` and the exported name (`acmeWorkApp`) |
| `meta.ts` | `id`, `appTemplateKinds: ['acme']`, the keys of `features` and `uses`, **every text key** (`acme.…`) and the exported name (`acmeWorkAppMeta`) |
| `templates.ts` | sheet template name and family (`acme.expenses`) |
| `modules/*.ts` | module ids (`acme.total`, `acme.import-csv`) |
| `tools.ts` | tool names (`acme_summary`, `acme_send_total`) |
| `app-template.ts` | `kind: 'acme'`, module ids, the AI guide |

The names that must start with your id:

| Name | Rule | Example |
|---|---|---|
| Text keys | `<id>.` | `acme.col_amount` |
| Module ids, sheet template names and families | `<id>.` | `acme.total`, `acme.expenses` |
| App template (kind) | `<id>` or `<id>-…` | `acme`, `acme-travel` |
| AI tools | `<id>_` | `acme_summary` |
| Declared sends and database queries | `<id>.` | `acme.report`, `acme.open-orders` |

Because of these prefixes, your app can use the same column names as any other app (`date`, `amount`) and still
show its own texts, and a later version of AI Talk cannot break your names by adding its own.

## 2. Add it to your installation

Two files list the Work Apps your company adds. Our updates never change them.

`src/work-apps/custom.ts`:

```ts
import type { WorkAppFactory } from '@/lib/work/package'
import { acmeWorkApp } from './acme'

export const CUSTOM_WORK_APPS: readonly WorkAppFactory[] = [acmeWorkApp]
```

`src/work-apps/custom-meta.ts` (the same apps, in the same order — the browser loads this light list):

```ts
import type { WorkAppMeta } from '@/lib/work/package-meta'
import { acmeWorkAppMeta } from './acme/meta'

export const CUSTOM_WORK_APP_METAS: readonly WorkAppMeta[] = [acmeWorkAppMeta]
```

## 3. Test

```bash
npm test
```

This runs your app's own tests (`src/work-apps/acme/*.test.ts`) and the core checks over every registered app:
names, texts, modules, tools. A broken app does not start half-working — **all Work Apps stop** with a message
`work app registry: …` that says what is wrong. Run the tests before you build.

## 4. Build and run

```bash
docker build -t aitalk-selfhosted:1.0.2-acme1 .
```

In your install folder, set `AITALK_IMAGE=aitalk-selfhosted:1.0.2-acme1` in `.env` and run
`docker compose up -d` (back up the database first — README, *Upgrades and backups*).

Build with the `Dockerfile` and `package.json` of this repository as they are. Do not remove dependencies you do not
use yourself — the database drivers (`pg`, `mysql2`, `tedious`) are needed for the company database, and a missing one only
shows when someone connects.

## 5. Use it

1. Your first agent already has a deployed workflow **Blank** — open it in **Agent Studio**. (For another agent,
   create a workflow from the card **Blank** under **New Workflow** — not the button **Blank Workflow**, which makes an
   empty workflow without a work app.)
2. Click its **Work app** step (the box between Start and End) and choose your app template under **App template**
   (or leave it open — the user then picks it in the first chat). Deploy the workflow again after the change.
3. **Open app** (in the same step) opens the work app. The administrator and invited team members can open it — invite
   members in **Settings → Team** and choose this app in the invitation; after accepting (they set a password) it
   takes them to the app, where they sign in once.
4. In the example: create a task for a month, upload a CSV file in the **Files** tab and ask the AI to import it.
   The rows arrive unconfirmed; confirm them, look at the total, close the month.
5. To send the total by email, pick an email connection for **Email for sending month totals** in the same
   **Work app** step (**+** creates one — SendGrid or your SMTP server) and deploy again. Then ask the AI to send the
   closed month to an address: it puts an email card in the chat and in the **Sending** tab, and nothing leaves until
   someone presses **Send**.

## The parts, in detail

Everything your app needs from the core comes from **one import**: `@/lib/work/package-api` (the contract).
Import nothing else from the core — other files change between versions. Your own files may import each other.

### Sheet templates — `templates.ts`

```ts
export const expensesTemplate: SheetTemplate = {
  name: 'acme.expenses', version: 1, family: 'acme.expenses',
  columns: [
    { name: 'date', type: 'date', required: true },
    { name: 'description', type: 'string', required: true },
    { name: 'amount', type: 'money', required: true },
  ],
  dateColumn: 'date',                         // rows dated in a closed period are locked
  confirm: { calcColumns: ['date', 'amount'] }, // a person confirms rows; changing these columns unconfirms
}
```

- `confirm.ai: { reasonColumn: 'aiReason' }` lets the AI confirm a row when it writes its reason in that column
  (add a `check` function for rules the row must meet first). Without it, only people confirm.

- Column types: `string`, `text`, `number`, `boolean`, `date`, `datetime`, `json`, `money` (decimal text `"12.50"`),
  `decimal` (with `scale`). `encrypted: true` stores a `string`, `text` or `json` column encrypted.
- `unique: ['col', …]` — no two rows with the same values. `ui.hidden` — columns people do not type (your module
  fills them). `ui.options` — a pick list for a column.
- **Versions only add columns.** Never rename a column or change its type: rows in closed periods cannot be
  rewritten. If you need a different shape, make a new template name in the same family.

### The app template — `app-template.ts`

- `sheets` — the sheets created with every work app (template name `@` version, and a display name).
- `modules` — the modules switched on; `calcModule` — the calculation sealed when a period is closed (or `null`).
- `aiGuide` — **the AI's instructions** for this app, in English: what the work is, what to ask first, the order
  of work, which module gives which number. It is added to every turn, so changing it changes existing work apps
  at once. Tell the AI to leave confirming to people and to take numbers only from your calculation module.
- `ui.period` — `month`, `quarter`, `year` or `custom` (how a new task's period is chosen).
- `ui.settings` / `parseSettings` — settings asked when the app template is applied and changed later in the
  **Setup** tab (a person only — the AI cannot). `parseSettings` checks the whole object both times; a text field the
  person cleared arrives as `''`. Check them strictly.

### Modules — `modules/`

A **calculation module** (`kind: 'calc'`) runs inside the close of a period. It only reads, through its context:
`ctx.periodRows(family)` gives every row of the period (confirmed or not). Its result is sealed with the period.
Give it a `preview` that returns the confirmed figure and the figure with unconfirmed rows, so people see both.

An **action module** (`kind: 'read' | 'check' | 'make' | 'prepare'`) runs when a person or the AI asks for it. It
gets **handles** — the only way to the data:

| Handle | Does |
|---|---|
| `ctx.sheets.list(family)` · `read(sheetId)` · `schema(template)` · `submittedPeriods()` | Read this work app's sheets |
| `ctx.sheets.write({ sheetIds }, async (w) => …)` | Write rows in one lock: `w.insert`, `w.update`, `w.rows`, `w.lockedPeriods`, `w.sheetsOfFamily` |
| `ctx.sheets.create({ name, template })` | Add a sheet |
| `ctx.files.info(fileId)` · `read(fileId)` | Files of this work app (the read is logged for whoever asked) |
| `ctx.tasks.list()` · `get(taskId)` | Tasks and their periods |
| `ctx.modules.run(moduleId, input)` | Run another module, as the same person or AI |

Rows your module writes are recorded as written by the module and stay unconfirmed. A row in a closed period stops
the whole write (`LOCKED`) — put all rows of one import in **one** `write`, so nothing is half written. The example
also refuses a file that is already in the sheet, because importing it twice would count every expense twice.

When something is wrong, **stop instead of skipping**: `throw moduleStop('csv_line', 'developer detail', { line: 3 })`.
People see the text `acme.stop_csv_line` (with `{line}` filled in); the detail goes to the logs. Use
`new WorkError('INVALID' | 'NOT_FOUND' | …)` for wrong input.

### AI tools — `tools.ts`

Optional functions only your app's AI sees, named `<id>_…`. A tool gets the same handles, as the AI: the same rules
apply to what it writes as to the AI's other writes. The AI can already read and write rows and run your modules with
the shared tools — add a tool only for something those cannot do well.

### Texts — `meta.ts`

```ts
i18n: { en: { 'acme.kind_acme': 'Expenses', 'acme.col_amount': 'Amount', 'acme.stop_csv_line': 'Line {line} …' } }
```

English is required; add `de`, `fr` or `ko` with the same keys when you want them. The screen builds keys from your
names: `kind_<kind>` (app name), `sheet_<family>`, `col_<column>`, `opt_<value>`, `mod_<module>`, `res_<result>`,
`set_<setting>`, `in_<input>`, `stop_<code>` — each with your `<id>.` in front. A missing text shows the raw name.
`features` lists what the app does and what is planned (shown before someone picks the app template). A feature
with `module: true` must use the module's id, and its label must be the same as the module's `title` — `npm test`
checks this, so the list never promises a module the app does not have.

## Contract versions — Work SDK

Your app says which version of the core contract it was written for: `core: N` in `index.ts`. We call that version
**Work SDK 0.N** — `core: 3` is Work SDK 0.3, `core: 10` is Work SDK 0.10. The number in your code stays a plain
integer. This version of AI Talk supports `core: 1` to `core: 10`; a newer AI Talk keeps supporting every number it
supported before (versions only add). The example app is written for `core: 3`. Each version adds to the one before —
the next section is 0.3, and [Work SDK 0.4 to 0.10](#work-sdk-04-to-010) lists what came after.

## What your app can use (Work SDK 0.3)

With `core: 3` your app can reach outside its sheets — but only what it **declares**. The declaration is `uses` in
`meta.ts`, one entry per app template. A capability you do not declare has no handle in `ctx` and no AI tool.

```ts
uses: {
  acme: {
    connections: [
      { id: 'mail', kind: 'email', label: 'acme.conn_mail' },
      { id: 'erp', kind: 'database', engine: 'postgres', label: 'acme.conn_erp' },
    ],
    sends: [
      // Automatic: the address comes from a setting a person typed — never from the AI
      { id: 'acme.report', via: 'mail', to: { setting: 'reportEmail' }, auto: true, label: 'acme.send_report' },
    ],
    knowledge: true,
    webSearch: true,
    dbQueries: [
      { id: 'acme.open-orders', via: 'erp', mode: 'read', label: 'acme.q_open_orders' },
      { id: 'acme.set-status', via: 'erp', mode: 'write', label: 'acme.q_set_status' },
    ],
    inbox: [{ family: 'acme.requests', identify: { column: 'customer', by: 'telegram' }, readable: ['subject', 'status'] }],
  },
},
```

Every `label` is one of your text keys. `npm test` checks the declaration against your app templates, sheets and
settings — a mistake stops all Work Apps with `work app registry: …`, as with names.

What you get:

| Declared | Handle in `ctx` (modules and your AI tools — type `V3WorkAppTool` / `V3ActionWorkModule`) | Shared AI tool |
|---|---|---|
| always, with `core: 3` | `ctx.settings()` — this work app's settings · `ctx.llm.ask(prompt)` — one AI answer (when the AI is working: in your AI tools and in modules the AI runs, not in a module started by a person's button) | — |
| `connections` | `ctx.send(…)` | `work_send` |
| `knowledge: true` | `ctx.knowledge.search(query, { topK })` | `work_search_docs` |
| `webSearch: true` | — (the AI of this app may read pages people give it and search the web) | built in |
| `dbQueries` | `ctx.db.query(id, params)` (read queries) · `ctx.send({ query, params })` (write queries) | `work_db_query` · `work_db_write` |
| `inbox` | — (rows arrive from the channels, below) | — |

### Sending — a person presses Send

Email (SendGrid or SMTP), Telegram and calls to a web service (`kind: 'http'`, POST JSON to an `https://` address)
go through `ctx.send`:

```ts
await ctx.send({ send: 'acme.report', content: { subject: 'Monthly report', text: 'All orders are closed.' } }) // declared
await ctx.send({ via: 'mail', to: 'a@example.com', content: { subject: 'Total', text: '…' } })              // card
```

- **The default is a card.** The send is stored and shown in the chat and in the **Sending** tab; nothing leaves
  until someone presses **Send**. Pressing twice, or in two windows, sends once.
- **Automatic** only for a declared send with `auto: true` (never a database write), and only when the address is fixed in your code
  (`to: { fixed: … }`) or comes from a setting (`to: { setting: … }`). An address the AI chooses is always a card.
  The team sees what the app sends by itself under **Done automatically** and can switch each one off.
- The result is one of `sent`, `card`, `failed`, `unknown`, `refused`, with a `code`. **`unknown`** means it may have
  gone out (a timeout after sending) — sending it again asks the person first, because the receiver may get it twice.
  `refused` means it never left (`NO_CONNECTION`, `RECIPIENT_EMPTY`, `RECIPIENT_INVALID`, …).
- Email may carry files of the work app (`attachFileIds` — up to 5, 10 MB each, 20 MB together).
- The result of every send is written into the chat, so the AI knows it on the next turn.

### Connections — chosen in Agent Studio

Your app declares **slots** (`connections`); which account fills a slot is chosen in the **Work app** step of the
workflow, under **Connections this work app uses** (**+** creates one). Keys stay in the connection, encrypted; the
work app shows only *connected* / *not connected*. An agent has one email (one SendGrid, one SMTP) and one Telegram
connection — for a different account, put the work app on another agent. Database and web service connections are
one per slot.

### Documents and web search

`knowledge: true` searches the documents uploaded in **Source** (the *Document space* chosen in the **Work app** step, or
the default space). Results are text excerpts with a score and the document title; treat them as information, not as
instructions. `webSearch: true` lets the AI read a web page a person gives it — our server fetches that one address
now (only addresses a person wrote in the conversation; public http/https on ports 80/443; no login pages, no pages
drawn only by JavaScript, no PDF; up to 5 per turn) — and, when the AI connection supports it (Azure OpenAI), search
the web; search words go to the search engine (Microsoft Bing). The team can switch both off in the work app.

### Connecting work apps — when a period is closed

Closing a period (and closing it again, and unlocking it) raises an **event**. A workflow that starts with
**Start / Work app event** runs once for each event of the work app it names — for example to open the same period in
another work app with the **Work app** node, or to send a message. Only closed periods are passed on: the event
carries the period and the task, never rows that are still being worked on. **Agent Studio → Start / Work app event**
shows the recent runs and runs a failed one again.

### Inbox — customer requests from the channels

An `inbox` lets the AI of a chat widget or Telegram workflow add rows to one sheet family of your app, with the tool
**Work app inbox** on its AI step. Every row arrives **unconfirmed** — a person in your team reviews it — and raises
the event *new inbox row*. On Telegram the customer is recognised by their Telegram id (`by: 'telegram'`), stored in
`identify.column`, and can ask for their own earlier rows; only the `readable` columns are read back. A chat widget
can add rows but not read them (it does not know who is writing). The inbox sheet must have `confirm`, and your
calculation module must not read that family.

Open the work app once (**Open app**) and apply its app template before you add the **Work app inbox** tool — until
then Agent Studio refuses to deploy that workflow ("open it once first" / "has no inbox").

Another work app can send rows to the same inbox: on a workflow canvas, draw a **send** line from one **Work app**
node to another and pick the inbox. While that workflow is deployed, the AI of the sending work app can put the rows
it picks on a card; a person presses **Send**, and the rows arrive **unconfirmed** in your inbox (written by
`app:<sending workflow>`, the same event *new inbox row*). The sender can only add rows — never edit, delete or
confirm them. Your app needs nothing extra for this; the `inbox` declaration is enough.

### Company database

Declare a `database` slot with its `engine` — `mysql` (also MariaDB), `postgres` or `mssql` (SQL Server 2017 and
later, Express and Azure SQL included) — and write each query in `index.ts`. **Leave `engine` out** and the person
picks the database type when they connect the slot (MySQL, PostgreSQL or SQL Server); such a slot is for AI SQL only
(see below) — queries written in your app need a slot with an engine, and the app does not load otherwise:

```ts
dbQueries: {
  'acme.open-orders': { sql: 'SELECT id, total FROM orders WHERE customer = $1 AND status = $2', params: ['customer', 'status'], maxRows: 100 },
  'acme.set-status': { sql: 'UPDATE orders SET status = $1 WHERE id = $2', params: ['status', 'id'] },
},
```

- Write the SQL for that engine: placeholders are `?` in MySQL and `$1`, `$2` in PostgreSQL, filled from `params` in
  order, and `@name` in SQL Server, filled by name (each name in `params` must appear as `@name` — checked when the app
  loads). The core does not change your SQL and always binds values — never build SQL from text.
- Values must match the parameter names exactly and be text (up to 2,000 characters), a finite number, `true` /
  `false` or `null`.
- **Reads** run in a read-only transaction (a read query cannot change anything), with 10 seconds to connect and 15
  seconds per statement (on MySQL and MariaDB versions that cannot limit a statement, AI Talk stops waiting after 20
  seconds). They return `{ rows, truncated }`: `maxRows` rows (default 200, at most 1,000) or 2 MB,
  whichever comes first — `truncated: true` means there is more. Dates come as the database's text, big integers
  and decimals as text, binary columns as `[binary N bytes]`, and each value is cut at 4,000 characters. Every read
  is logged (query, row count — not the values).
- **SQL Server is different in three ways.** (1) It has no read-only transaction: a read runs in a transaction that
  is always rolled back, and a read query must be **one `SELECT`** (or `WITH … SELECT`) with no other statement word,
  `INTO`, locking hint or system procedure anywhere — otherwise the app does not load. (2) Writes cannot `BEGIN`,
  `COMMIT`, `ROLLBACK` or `SAVE` a transaction (AI Talk wraps each in one); if a write calls a procedure, or a
  trigger ends the transaction, a failed write is reported as `unknown` (it may have been applied). Some errors make
  SQL Server roll the whole transaction back itself (a name that already exists, a failed conversion); those are also
  reported as `unknown` although nothing was written. (3) The time limit is 15 seconds per statement, enforced by
  AI Talk cancelling it. Decimals with more than 15 significant digits come rounded (`CAST(x AS NVARCHAR(50))` for
  exact digits), times are cut to milliseconds, and `DATETIMEOFFSET` comes in UTC. With several statements or
  triggers, `affectedRows` is the count of the last statement.
- **Writes** (`mode: 'write'`) are sends: one statement in a transaction, **always as a card** — a person presses
  **Send** before anything changes in your database. A declared send may name a write query
  (`{ id: 'acme.set', query: 'acme.set-status', label }`) but cannot make it automatic: `auto: true` on it is
  rejected when the app is loaded. The card shows the query, the values
  and the database; the result is the row count the database reports (`affectedRows` — for an `UPDATE`, the rows it matched,
  also rows whose values were already the same). `0` is a result, not an error; what it means depends on your SQL
  (no row matched, or an `INSERT … ON CONFLICT DO NOTHING` that skipped). If you change the SQL
  after a card was made, that card is refused (`QUERY_CHANGED`).
- The connection form asks for host, port, database, user, password and TLS (`verify` by default; `no-verify` or
  `off` for a server without a certificate). SQL Server: the TCP port, not an instance name (SQL Server Express uses a
  changing port by default — set a fixed TCP port), and a SQL Server login, not Windows sign-in. For accounting
  programs that keep their books in SQL Server (Topal, PROFFIX, Sage …), read mostly: writing their tables directly
  can upset the books and the vendor's support. For a database with its own certificate (Aiven, Supabase, AWS RDS …),
  paste the service's CA certificate to keep `verify`. Self-hosted can reach addresses in your network and on the same
  server; link-local and cloud metadata addresses are always refused (`ADDRESS_BLOCKED`).
- **AI SQL (off by default).** In Agent Studio, a database slot can be switched to *Let the AI write SQL for this
  database*. Then the work app's AI may write its own SQL for that slot, without a query in your code: reads
  (`SELECT` · `WITH` · `SHOW` · `EXPLAIN` · `DESCRIBE`, one statement) run at once in a read-only transaction; anything
  that changes rows or tables (`INSERT` · `UPDATE` · `DELETE` · `CREATE` / `ALTER` / `DROP TABLE` …) becomes a card with
  the exact SQL that a person must **Run** — everything except a plain `INSERT`, `CREATE TABLE` or `ALTER TABLE … ADD`
  (on MySQL: a plain `INSERT` only; on SQL Server: a plain `INSERT … VALUES` only) asks a second time. The card is bound to the database it was made for; if the
  connection changes, it is refused. Give that slot's database user no file or admin rights and no outside-connection
  extensions (dblink and the like) — the read checks cannot block what those rights allow.

## Work SDK 0.4 to 0.10

Set a higher `core:` only when you want something from that version — a handle of a higher version is simply not in
`ctx` for an app that declares a lower one, and the registry refuses a declaration your version does not have
(for example `work app registry: … needs core 10`). Everything comes from `@/lib/work/package-api`; the types of each version keep
their own names (`V5ActionWorkModule`, `V7ModuleRunCtx`, `V8WorkAppTool` …), so upgrading AI Talk never changes what
your app gets while its `core:` stays the same. Raising your app's own number can need changes: from `core: 1` to 2
or higher your app loses `ctx.deps`, and a calculation module may no longer have `prepare` — move other preparation
into an action module; only for fetching monthly exchange rates before a close is there a declaration
(`fetchFxMonthly: true`, which needs `core: 8`). Write the number as a literal (`core: 7`), never the constant
`WORK_APP_CORE_API` — the constant moves with every AI Talk version.

| Work SDK | `core:` | Adds |
|---|---|---|
| 0.4 | 4 | Row writer: `w.remove`, row pairs `w.pair` · `unpair` · `pairsFrom` (the pair kinds your template declares), `w.addFile` (a file prepared with `ctx.fileUpload` becomes a file row in the same write), public download links `w.addPublicLink` · `revokePublicLinks`; numbering `ctx.counters.next(name)`; template columns `moduleOnly` (only your modules write them) and `fileColumns`; a send can carry a `ref` to a row and your package can react after it went out (`sendRefs`), `w.discardSendsFor(rowId)` drops waiting cards of a row; references `periods(referenceId, range)` (the connected app's tasks that overlap the range, whatever their status — the range is required) with the pure helper `uncoveredRanges(periods, range)` (the days of the range that no submitted period covers — empty means all closed), and `rows(…, { columns, dateIn })`; an `example` for a setting field; `ctx.tasks.sealed(taskId)` (the sealed result of a closed period); the calculation context tells `mode` (preview or close) |
| 0.5 | 5 | `ctx.references()` in action modules, your AI tools and screen code — read the sheets of the apps your app is connected to by a reference line on the canvas (`{ fresh: true }` reads again; `rows(…, { ids })` reads only those rows — 1 to 500 ids, only the returned rows count as read and their confirm state is watched too, not together with `dateIn` or `watch`); `confirm.before` — a check that runs before rows are confirmed, with `settings()`, `fxMonthly()`, `fingerprint()` and `serialize(name)` (one check at a time per name, for checks that read another app); `ctx.proposeConfirm` — the AI proposes rows to confirm on a card a person presses; `ui.derivedFrom` — columns computed by your module's `screenRows` (not stored); `ctx.fingerprint(label, value)`; `ctx.proposeAppSend` — a card that sends rows to another work app |
| 0.6 | 6 | `meta.shared` — an app template other workflows can point at with a **link node** (one app used from several canvases) |
| 0.7 | 7 | **Who**: a module started by a person gets that `person`; template `confirm.byModule` (only a module a person pressed confirms — not the AI, not the table); row writer `w.confirm(rowIds)`; `who` in `writeRule` and `confirm.before`; template `deleteRule`; `ctx.members()` · `ctx.ownerName()`; `ctx.fxMonthly(currency, date)` (the stored Swiss monthly rate for that month — `null` until it was fetched, see 0.8); `ctx.referencedCells(family)` (computed columns of a connected app); `ctx.sendAppNow` (a person's module sends to another work app without a card); `ui.filterFrom` with a module (`screenFilter`) |
| 0.8 | 8 | `ctx.fetchFxMonthly({ months, currencies })` — fetch and read Swiss customs (BAZG) monthly rates (the server calls the BAZG site); a calculation module may declare `fetchFxMonthly: true` and the core fetches the period's months before the close; helpers `isFxMonth`, `monthsBetween`, `MAX_FX_MONTHS` |
| 0.9 | 9 | `references()` entries carry `sourceBooks` — which company books the connected app itself reads (to check two apps work on the same company) |
| 0.10 | 10 | Pick lists in the row editor from your module: template `ui.choicesFrom: { module, columns, follow? }` + action module `screenChoices(ctx)` → `{ column: [{ value, label?, hints? }] }`; `follow` fills a second column from the first (when it is empty or still the previous pair) |

**Find it by what you want to do.** Before you write something yourself, check here — the core may already do it.
"—" means any version.

| You want to | Use | From |
|---|---|---|
| Show where each row stands — a coloured dot and a reason | template `ui.dotFrom` (a computed column) · `ui.dotWhyFrom` (texts `dotwhy_<value>`) | — |
| Hide finished rows by default | template `ui.hideWhen` (people can show them) | — |
| Row buttons (copy, PDF, ask for a reason, show only when …) | template `ui.rowActions[]` — `icon`, `input`, `ask` (`reason` · `confirm`), `when`, `result: 'pdf'`, `primary`; `ui.textButtons` shows them as words | — |
| Buttons above the table (do something with many rows) | template `ui.sheetActions[]` — `module`, `input`, `ask: 'confirm'`, `setting` | — |
| Close a row (reason and today's date, then confirm) | template `ui.closeActions` | — |
| Call confirming "approve" on a sheet | template `ui.confirmAs: 'approve'` | — |
| Country columns, yes/no order | template `ui.countryColumns` · `ui.noFirst`; `COUNTRY_CODES` · `SANCTIONED_COUNTRIES` | — |
| Pick a value from another sheet · a one-line summary of the paired row | template `ui.refs` · `ui.summary` | — |
| Filter the table by a value next to the year | template `ui.filterFrom` — `{ column }` (a column in `search.keys`) or `{ module }` (`screenFilter`) | `column` — · `module` 0.7 |
| Download the table as Excel, CSV or PDF | template `ui.download` · `ui.details.download` | — |
| A column people see but cannot edit | template `ui.viewOnly` | — |
| Large tables (tens of thousands of rows), 50 rows at a time, by year | template `search` | — |
| Draw a module's result as sections and tables | app template `ui.resultSections` | — |
| A design tab for your PDF documents (logo, letterhead, colours) with a preview | app template `ui.design` + `designPreview` | — |
| Columns computed from other columns (not stored) | template `ui.derivedFrom` + module `screenRows` | 0.5 |
| Pick lists filled by your module | template `ui.choicesFrom` + module `screenChoices` | 0.10 |
| Let the AI read uploaded PDFs and pictures page by page | shared AI tool `work_read_documents` — nothing to write | — |
| Turn what the AI read into rows, one decision per file | app template `cardRows` (`AppCardRow`) · shared tool `work_file_decisions` | — |
| Several files on a row · open a row from a file column | template `ui.moreFiles` · `ui.openFiles` | — |
| Files your app keeps as records (people cannot upload there) | template `recordFiles` · app template `ui.files: 'kept'` | — |
| Ask a person to attach files — a card with a file picker | proposal `attach_files` (`ctx.propose`) | — |
| A one-line notice in the team's General room | module result `notice: { key: 'notice_…', params: { name: integer } }` | — |
| A rule for every insert and update (no change after approval …) | template `writeRule` | — · `who` 0.7 |
| Check before rows are confirmed (against another app, a rate …) | template `confirm.before` | 0.5 |
| The AI proposes "confirm these rows?" | `ctx.proposeConfirm` | 0.5 |
| Only a person's button confirms; record who | template `confirm.byModule` · `w.confirm(rowIds)` | 0.7 |
| A rule for deleting rows | template `deleteRule` | 0.7 |
| The team members · the owner's name | `ctx.members()` · `ctx.ownerName()` | 0.7 |
| Tick "I have checked" before an action that is hard to undo | app template attention `ask: 'check'` | — |
| Review several items one by one (approve / reject) | app template attention `review.items.actions[]` | — |
| Read another app's sheets (reference line on the canvas) | `ctx.references()` | 0.5 (calculation modules read references in every version) |
| Read another app's computed columns | `ctx.referencedCells(family)` | 0.7 |
| One app used by several canvases | `meta.shared` + link node | 0.6 |
| Receive rows from other apps and channels · a waiting line above the chat | `uses.inbox` · template `ui.waitingWhenEmpty` | 0.3 |
| Send rows to another work app | `ctx.proposeAppSend` (card) · `ctx.sendAppNow` (a person's module) · shared tool `work_send_app` | 0.5 · 0.7 |
| A preview before rows are sent | template `select.summary` | — |
| Link a row to what was sent for it (an invoice email) | send `ref` + package `sendRefs` | 0.4 |
| A to-do line that writes into the chat or opens a sheet | app template attention (`ask`, `open: { family }`) | — |
| Table sort order · ask-the-AI buttons on a sheet | template `ui.sortBy` · `ui.askButtons` | — |
| Monthly exchange rates (CHF) | `ctx.fetchFxMonthly` fetches the months (BAZG) · `ctx.fxMonthly(currency, date)` reads a fetched month | 0.8 · 0.7 |

Things the core does by itself for every app — nothing to write: a card a person pressed still shows as done after a
reload; a table the AI writes in the chat gets Excel, CSV and PDF buttons; a CSV or Excel file attached to a message
is read by the AI in that turn (up to 400 rows; the first five Excel sheets).

**Not in Self-hosted.** Some core features exist for AI Talk Cloud apps (the bank ledger, invoices, expenses) and have
nothing to work with here: shared libraries (`libs` — the registry refuses an app that declares one, because this
installation has none), the bank-ledger handles (`proposeLedgerLink`, `ledgerLinkSetup`, `proposeLedgerStatement`, the
`{ statement }` import reader) and `meta.companyBook`. Do not build on them.

## Upgrading AI Talk

- Take our new version into your branch. Your folder and the two list files do not conflict with our changes.
- Your app declares the contract version it was written for: `core: 3` (the example) — Work SDK 0.3. Apps written
  for `core: 1` to `core: 9` keep working without changes; raise the number only when you want something from a
  higher version ([Work SDK 0.4 to 0.10](#work-sdk-04-to-010)). A newer AI Talk keeps supporting your version, or
  refuses to start Work Apps with a clear message if it cannot.
- Run `npm test`, build the image, back up, `docker compose up -d`.
- Apps written for contract version 1 also get `ctx.deps` (the core's internals). Their shape may change in any
  version, and version 2.0 removes them — use the handles.

## Limits of this version

- Your app keeps its data in sheets. It cannot add its own database tables, pages or HTTP routes. It can read and
  write **your company database** with the queries it declares (see *Company database*).
- The calculation module cannot call outside services or use `uses`; get what it needs into a sheet first (an action
  module or an AI tool).
- Settings (`ui.settings`) are changed in the **Setup** tab, not while a task waits for approval. A declared send
  whose address comes from an empty setting is refused (`RECIPIENT_EMPTY`); a waiting card uses the address at the
  moment it is sent.
- Email is plain text. Text messages (SMS) and phone calls are not part of Self-hosted: an inbox can identify people
  by Telegram; `by: 'phone'` is accepted but no phone call reaches it.
- A send made by an action module appears in the **Sending** tab, but not as a card in the chat.
- Texts for the core screens come from AI Talk; your app adds only its own.
- Self-hosted is for building the Work Apps your company needs yourself, with this guide — it does not ship a
  finished app for every task. The one built-in app is the Swiss VAT return of version 1.0.1, unchanged (written for
  `core: 1`), as a sample; for the newer contract versions use the tables above and the types in `package-api`.
