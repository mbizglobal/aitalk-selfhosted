# License FAQ

This page explains how M-BIZ Global AG reads the licenses of AI Talk. It is **not part of the license**.
If this page and a license text ever disagree, the license text wins:

- [`LICENSE`](LICENSE) — the Sustainable Use License, for everything outside `src/ee/`
- [`src/ee/LICENSE`](src/ee/LICENSE) — the AI Talk Enterprise License, for `src/ee/`

AI Talk is **source-available**. It is not open source in the sense of the Open Source Initiative,
because the Sustainable Use License limits commercial redistribution.

If your case is not listed here, or you are unsure, ask us before you rely on it: **support@aitalk.ch**.

## Free — no license fee

| Who | What |
|---|---|
| A company, bank or team | Installs AI Talk on its own servers and uses it for **its own internal business**. Modifying it and running your own modified version is allowed. |
| A group of companies | One installation shared by companies of the same group (as defined by "your company" in the license), with no outside clients on it. |
| Individuals | Personal or non-commercial use, including learning and testing. |
| Consultants and integrators | Install, configure and operate AI Talk **on a client company's own servers** for that client, and charge for that work. |
| IT service providers | Run an installation on their own servers that is **dedicated to one client company** and used only for that client's own business. |

Using AI Talk without an Enterprise License key is free in all of the cases above. The `src/ee/` code ships
with the software, but its features stay off until a valid key is installed. Running the software without a key
does not require an Enterprise License.

## Needs a commercial license from us

| Who | What |
|---|---|
| IT service providers | One installation that serves **several client companies** (a shared service). |
| Trust companies, accounting firms and similar | Your staff process the books or tasks of **several client companies** in one installation and hand over the results, or your client companies get their own logins. |
| Service companies building on AI Talk | You run AI Talk behind your own product or screens to serve **several customer businesses** whose work and settings are kept apart in it (for example one booking assistant per restaurant). If those customer businesses can also change how the AI behaves (its instructions, conversation flows or rules), this needs an OEM agreement. |
| Anyone | Enabling the features in `src/ee/` (an Enterprise License key). |

Two questions decide most cases:

1. Does the installation keep the work of **several client companies** apart (separate data or settings per client)?
   If yes, it needs a commercial license.
2. Can those client companies **change how the AI behaves**, through any screen, API or AI?
   If yes, it needs an OEM agreement.

If both answers are no, your own customers and visitors simply using your service is your own business,
even when they are outside your company.

## Not allowed

- Selling AI Talk, or a modified version of it, as your own product.
- Offering AI Talk to others as a hosted or managed service, for a fee or as part of a paid offer.
- Distributing AI Talk or a modified version for commercial purposes.
- Removing or hiding the license, copyright or other notices.
- Enabling `src/ee/` features without a valid key, or working around the key check.

## Other questions

**May we read and audit all of the code, including `src/ee/`?** Yes. Reading, reviewing and security
testing the code for your own evaluation is fine without a key. Under the Enterprise License you may also
copy and modify `src/ee/` for development and testing.

**What happens to our installation if M-BIZ Global AG stops?** An installation keeps running; it does not
call our servers and the license key is checked offline. Continuity terms for production use (for example
access to the last version and its sources) can be agreed in an Enterprise license or support agreement — ask us.

**Do we have to send you our modifications?** No. The Sustainable Use License does not require you to
publish or send changes. If you distribute a modified copy (free of charge, for non-commercial purposes),
it must carry these license terms and a notice that you modified it.

**Third-party components** keep their own licenses — see [`NOTICE`](NOTICE).
