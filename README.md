# AI Talk — Self-hosted

AI agents and workflow automation that you run on your own servers. Build workflows with AI steps, connect
your own AI service, let the AI answer from your own documents, and use business apps (the first one prepares
Swiss VAT returns) — with your data staying in your installation.

This is the source of **AI Talk Self-hosted** and **AI Talk Business** (the same software; Business features
are switched on with a license key). The hosted service is AI Talk Cloud at https://www.aitalk.ch.

**License: source-available.** Free for your own company's internal business, and for consultants, freelancers and
agencies who build and run it for clients — on the client's servers, in an installation dedicated to one client, or on
your own installation as long as your clients receive outputs, not access. Letting several client companies use one
installation you run (logins, screens, or building and changing its workflows), or running your own product for several businesses on it, needs a
commercial license from us. Selling it as a product is not allowed.
Read [`LICENSE`](LICENSE) and the plain-language [`LICENSE-FAQ.md`](LICENSE-FAQ.md)
before you use it. AI Talk is not open source in the sense of the Open Source Initiative.

## What is included

- Workflow studio with AI steps, tools and sub-workflows; chat widget for your website
- AI connections you choose: **Azure OpenAI**, any **OpenAI-compatible** service (vLLM, Ollama, OpenAI and others),
  or **Anthropic**
- Document search over your own files: built into the database (pgvector) by default, or your own search server
- Business apps (Work Apps) — Swiss VAT is the first
- Team members, roles and the MCP server for controlling AI Talk from other tools
- Runs without internet access: no calls to our servers, the license key is checked offline

**Not included** (AI Talk Cloud only): phone and voice calls, SMS, calendar booking tools, billing and the
AI Talk Cloud admin console. Workflows that use those steps cannot be saved in a Self-hosted installation.

## Install with Docker

You need Docker with Docker Compose and at least 5 GB of free disk for the images (more for your data). The installation has two
containers — the app and PostgreSQL with pgvector — and stores uploaded files in a Docker volume.

1. Use the published image `ghcr.io/mbizglobal/aitalk-selfhosted:<version>` (linux/amd64), or build it from this
   repository — you must build it yourself if you add your own Work Apps:

   ```bash
   docker build -t aitalk-selfhosted:<version> .
   ```

2. Make an **empty install folder** and copy `docker/docker-compose.yml` and `docker/.env.example` into it.
   Do not run it from the repository folder.

3. In the install folder, copy `.env.example` to `.env` and fill in at least:

   | Setting | What |
   |---|---|
   | `NEXTAUTH_URL` | The address your users open, e.g. `https://ai.example.com` (no trailing `/`) |
   | `NEXTAUTH_SECRET` | 32 characters or more — `openssl rand -base64 32` |
   | `ENCRYPTION_SECRET` | Exactly 64 hex characters — `openssl rand -hex 32`. Keep it with your backups: without it, saved AI keys and passwords cannot be read |
   | `POSTGRES_PASSWORD` | Letters and digits only — `openssl rand -hex 24` |
   | `AITALK_IMAGE` | The image tag from step 1 |
   | `SMTP_HOST`, `SMTP_FROM` (+ port, user, password) | Your mail server — for password reset and team invitations |

   Every other setting is optional and explained in `.env.example`.

4. Start it and open `NEXTAUTH_URL` in a browser:

   ```bash
   docker compose up -d
   ```

   The app listens on `127.0.0.1` only (port `APP_PORT`, default 3000). Put your HTTPS reverse proxy in front of it.
   On start, the app checks its settings, the database and pgvector, and applies database changes; if a setting is
   wrong it stops and says why (`docker compose logs app`).

5. The first visit shows **Create the administrator**. The account you create is the administrator and you are
   signed in at once — an installation has one account, and sign-up closes as soon as it exists. Do this right after
   the first start, before the address is reachable by others. Then open **Settings → AI connections** and add your
   AI service. The AI does not answer until a connection is added and checked. Your first agent already has a
   deployed **Work App** workflow — open it from its **Start / App** step in Agent Studio (**Open app**).

6. Your team does not sign up: invite them in **Settings → Team**. When you choose a Work App in the invitation, it
   takes the member to that app: they set a password when accepting, sign in once on the app, and sign in there from
   then on.

### AI on the same server

If you have no AI service, the compose file can run open models with Ollama on the same server: set
`COMPOSE_PROFILES=ollama` in `.env`, run `docker compose up -d`, pull a model
(`docker compose exec ollama ollama pull <model>`), and add an **OpenAI-compatible** connection with the address
`http://ollama:11434/v1`. A model needs its own size in memory plus the context window — an 8B model with a 16K
window needs more than 8 GB, and runs out of memory without a clear error.

### Uploaded files on S3

Uploaded files (documents, receipts) are kept outside the database — by default in the Docker volume `files`.
To keep them in your own S3-compatible storage (AWS S3, MinIO, Exoscale, …) instead, set in `.env`:

```bash
FILE_STORE=s3
S3_BUCKET=your-bucket
S3_REGION=your-region
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
# only for storage that is not AWS:
S3_ENDPOINT=https://s3.example.com
S3_FORCE_PATH_STYLE=true
```

and run `docker compose up -d`. **Decide this at installation.** Files already in the volume are not moved to S3:
if you switch later, files uploaded before the switch can no longer be opened or downloaded.

### Servers without internet

`docker/offline-bundle.sh <image tag> <folder> [ollama volume]` writes one archive with the app and database images
(and optionally Ollama with its models), a checksum and the compose files. On the server: check the checksum,
`docker load -i` the archive, fill in `.env` and `docker compose up -d`.

### Upgrades and backups

Back up the database **before** every upgrade — database changes are applied on start and cannot be undone:

```bash
f=backup-$(date +%F-%H%M%S).sql
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$f.part" \
  && [ -s "$f.part" ] && mv "$f.part" "$f" && echo "OK $f" || { rm -f "$f.part"; echo "BACKUP FAILED"; false; }
```

Then set `AITALK_IMAGE` to the new tag and run `docker compose up -d`. Also back up the files volume (or your S3
bucket, with `FILE_STORE=s3`) and keep `ENCRYPTION_SECRET` with the backups — the database alone lists your
documents but does not contain the files. The comments in `docker/docker-compose.yml` describe how to restore.

### Document search with your own search server

Instead of the built-in pgvector search, the AI can take its sources from a search system you already run:
set `KNOWLEDGE_STORE=http` and `KNOWLEDGE_HTTP_URL` / `KNOWLEDGE_HTTP_SECRET`. Ask us for the interface
specification.

## Work Apps

A Work App is a business app your team opens like a team chat: the AI does the work in the app's sheets, people
answer and confirm, and a period is closed with a sealed calculation. Swiss VAT is built in.

You can add your own Work App as one folder in `src/work-apps/<id>/` — sheet templates, an app template with the
AI's instructions, calculation and action modules, optional AI tools and the screen texts. The core draws the
screens, stores the data and enforces the rules (what the AI wrote stays unconfirmed, people confirm, closed periods
are locked). You add it with one line in `src/work-apps/custom.ts` and one in `src/work-apps/custom-meta.ts`, then
build the image yourself (Install, step 1). Our updates never change those two files.

Start with [`BUILD-A-WORK-APP.md`](BUILD-A-WORK-APP.md) and the example app in
[`src/work-apps/example/`](src/work-apps/example/).

## Business

The code in [`src/ee/`](src/ee/) is part of every installation but switched off until a license key is set
(`AITALK_LICENSE_FILE` or `AITALK_LICENSE`). Its first feature is approval of period closes in Work Apps.
Business licenses and support agreements: **support@aitalk.ch**.

## Known limitations of this version

- Some code comments are in Korean, and some refer to internal design documents that are not published.
- The image contains a few Azure SDK packages (`@azure/communication-email`, `@azure/identity`,
  `@azure/keyvault-secrets`, `@azure/storage-blob`) and `@google/genai`, because shared code imports them.
  They are not used and make no connections in a Self-hosted installation; a later version removes them.
- Prebuilt images are for `linux/amd64`. For other platforms, build the image yourself (step 1).

## Security, contributing

Report security issues as described in [`SECURITY.md`](SECURITY.md). We do not accept code contributions yet —
see [`CONTRIBUTING.md`](CONTRIBUTING.md). Third-party licenses: [`NOTICE`](NOTICE).

"AI Talk" is a name of M-BIZ Global AG. The license does not grant rights to it.
