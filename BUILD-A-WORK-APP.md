# Build a Work App

This guide takes you from an installed AI Talk Self-hosted to your own Work App, running in your installation.
It follows the example app in [`src/work-apps/example/`](src/work-apps/example/) — an expense list with a monthly
total — one file at a time. Copy it, rename it, change it.

## What a Work App is

A Work App is one folder in `src/work-apps/<id>/`. Your team opens it like a team chat: the AI does the work in the
app's sheets, people answer and confirm, and each period (a month, a quarter) is closed with a sealed calculation.

| You write | The core does |
|---|---|
| **Sheet templates** — the columns of your tables | Stores the rows (encrypted columns if you ask), draws the table, row editor, confirm buttons |
| **An app template** — which sheets, which modules, the AI's instructions, how periods work | Creates the sheets, the tasks (periods), the chat, the screens |
| **Modules** — a calculation that is sealed when a period is closed, and actions (import a file, check something) | Runs them for people and for the AI, logs who did what, locks closed periods |
| **AI tools** (optional) — functions only your app's AI can call | Gives the AI the shared tools (read and write rows, read files, run modules, propose notes) |
| **Texts** — English is enough | Shows them in the user's language when you add translations, in English otherwise |

The rules people rely on are enforced by the core, not by your code: rows written by the AI or by a module stay
**unconfirmed** until a person confirms them (your template may let the AI confirm rows it is sure about, with a
written reason); when a calculation column of a confirmed row changes, the row must be confirmed again; the AI can
delete only rows it added itself that nobody else touched; a closed period is **locked**; a period can only be closed
when every row in it is confirmed.

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
| `meta.ts` | `id`, `appTemplateKinds: ['acme']`, the keys of `features`, **every text key** (`acme.…`) and the exported name (`acmeWorkAppMeta`) |
| `templates.ts` | sheet template name and family (`acme.expenses`) |
| `modules/*.ts` | module ids (`acme.total`, `acme.import-csv`) |
| `tools.ts` | tool name (`acme_summary`) |
| `app-template.ts` | `kind: 'acme'`, module ids, the AI guide |

The names that must start with your id:

| Name | Rule | Example |
|---|---|---|
| Text keys | `<id>.` | `acme.col_amount` |
| Module ids, sheet template names and families | `<id>.` | `acme.total`, `acme.expenses` |
| App template (kind) | `<id>` or `<id>-…` | `acme`, `acme-travel` |
| AI tools | `<id>_` | `acme_summary` |

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
docker build -t aitalk-selfhosted:1.0.1-acme1 .
```

In your install folder, set `AITALK_IMAGE=aitalk-selfhosted:1.0.1-acme1` in `.env` and run
`docker compose up -d` (back up the database first — README, *Upgrades and backups*).

## 5. Use it

1. Your first agent already has a deployed workflow **Work App** — open it in **Agent Studio**. (For another agent,
   create a workflow from the template **Work App**.)
2. In its **Start / App** step, choose your app template under **App template** (or leave it open — the user then
   picks it in the first chat). Deploy the workflow again after the change.
3. **Open app** (in the same step) opens the work app. The administrator and invited team members can open it — invite
   members in **Settings → Team** and choose this app in the invitation; after accepting (they set a password) it
   takes them to the app, where they sign in once.
4. In the example: create a task for a month, upload a CSV file in the **Files** tab and ask the AI to import it.
   The rows arrive unconfirmed; confirm them, look at the total, close the month.

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
- `ui.settings` / `parseSettings` — settings asked when the app template is applied; check them strictly.

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

## Upgrading AI Talk

- Take our new version into your branch. Your folder and the two list files do not conflict with our changes.
- Your app declares the contract version it was written for: `core: 2`. A newer AI Talk keeps supporting it, or
  refuses to start Work Apps with a clear message if it cannot.
- Run `npm test`, build the image, back up, `docker compose up -d`.
- Apps written for contract version 1 also get `ctx.deps` (the core's internals). Their shape may change in any
  version, and version 2.0 removes them — use the handles.

## Limits of this version

- Your app keeps its data in sheets. It cannot add its own database tables, pages or HTTP routes.
- The calculation module cannot call outside services; get what it needs into a sheet first (an action module).
- Texts for the core screens come from AI Talk; your app adds only its own.
