# AI Talk — Self-hosted

AI agents and workflow automation that you run on your own servers. Build workflows with AI steps, connect
your own AI service, let the AI answer from your own documents, and use business apps (the first one prepares
Swiss VAT returns) — with your data staying in your installation.

This is the source of **AI Talk Self-hosted** and **AI Talk Enterprise** (the same software; Enterprise features
are switched on with a license key). The hosted service is AI Talk Cloud at https://www.aitalk.ch.

**License: source-available.** Free for your own company's internal business; selling it or offering it to others
as a hosted service is not allowed. Read [`LICENSE`](LICENSE) and the plain-language [`LICENSE-FAQ.md`](LICENSE-FAQ.md)
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

1. Build the image from this repository (or use an image tag you received from us):

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
   | `SELFHOSTED_ADMIN_EMAILS` | Accounts that may manage AI connections and the license (comma-separated) |
   | `SMTP_HOST`, `SMTP_FROM` (+ port, user, password) | Your mail server — for sign-up confirmation, password reset and team invitations |

   Every other setting is optional and explained in `.env.example`.

4. Start it and open `NEXTAUTH_URL` in a browser:

   ```bash
   docker compose up -d
   ```

   The app listens on `127.0.0.1` only (port `APP_PORT`, default 3000). Put your HTTPS reverse proxy in front of it.
   On start, the app checks its settings, the database and pgvector, and applies database changes; if a setting is
   wrong it stops and says why (`docker compose logs app`).

5. Sign up with an address listed in `SELFHOSTED_ADMIN_EMAILS`, then open **Settings → AI connections** and add
   your AI service. The AI does not answer until a connection is added and checked.

### AI on the same server

If you have no AI service, the compose file can run open models with Ollama on the same server: set
`COMPOSE_PROFILES=ollama` in `.env`, run `docker compose up -d`, pull a model
(`docker compose exec ollama ollama pull <model>`), and add an **OpenAI-compatible** connection with the address
`http://ollama:11434/v1`. A model needs its own size in memory plus the context window — an 8B model with a 16K
window needs more than 8 GB, and runs out of memory without a clear error.

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

Then set `AITALK_IMAGE` to the new tag and run `docker compose up -d`. Also back up the files volume and keep
`ENCRYPTION_SECRET` with the backups. The comments in `docker/docker-compose.yml` describe how to restore.

### Document search with your own search server

Instead of the built-in pgvector search, the AI can take its sources from a search system you already run:
set `KNOWLEDGE_STORE=http` and `KNOWLEDGE_HTTP_URL` / `KNOWLEDGE_HTTP_SECRET`. Ask us for the interface
specification.

## Enterprise

The code in [`src/ee/`](src/ee/) is part of every installation but switched off until a license key is set
(`AITALK_LICENSE_FILE` or `AITALK_LICENSE`). Its first feature is approval of period closes in Work Apps.
Enterprise licenses and support agreements: **support@aitalk.ch**.

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
