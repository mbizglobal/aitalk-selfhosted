# License FAQ

This page explains how M-BIZ Global AG reads the licenses of AI Talk. It is **not part of the license**.
If this page and a license text ever disagree, the license text wins:

- [`LICENSE`](LICENSE) — the Sustainable Use License, for everything outside `src/ee/`
- [`src/ee/LICENSE`](src/ee/LICENSE) — the AI Talk Enterprise License, for `src/ee/` (AI Talk Business license keys are
  issued under it)

AI Talk is **source-available**. It is not open source in the sense of the Open Source Initiative,
because the Sustainable Use License limits commercial redistribution.

If your case is not listed here, or you are unsure, ask us before you rely on it: **support@aitalk.ch**.

## Free — no license fee

| Who | What |
|---|---|
| A company, bank or team | Installs AI Talk on its own servers and uses it for **its own internal business**. Modifying it and running your own modified version is allowed. Your own customers and visitors using your service (for example chatting with your assistant) is your own business, even when they are outside your company. |
| A group of companies | One installation shared by companies of the same group (as defined by "your company" in the license). Client companies outside the group follow the rules below. |
| Individuals | Personal or non-commercial use, including learning and testing. |
| Consultants, freelancers, agencies and IT service providers | Charge for installing, building, running and maintaining AI Talk, workflows and Work Apps for your clients in any of these ways: (a) **on a client company's own servers**; (b) on your servers or cloud account, in an installation **dedicated to one client company** and used only for that client's own business — the client's staff may log in and use it; (c) on your own installation for any number of clients, as long as **your clients receive outputs, not access** (see below). |
| Trust companies, accounting firms and similar | Your staff use your installation to process the books or tasks of your client companies and hand over the results (returns, reports, messages) — as long as your clients receive outputs, not access. |
| Workshops and training | Participants get temporary access during a workshop, course or meetup. Remove their access when the event ends; the installation must not become a service they keep using. |

**Outputs, not access.** Your clients receive outputs when they get the results of the work: a report, a filed
return, synced data, an email, or the answers of an assistant you run for that client's own business. Your clients
have access when they log in to an installation you run, use its screens, or build or change its workflows, Work Apps
or how the AI behaves — through any screen, API, MCP or AI. Calling workflows or Work Apps you built for them through an
API, webhook or MCP and getting the results back is receiving outputs. Access to an installation that serves
**several** client companies is what needs a commercial license. An installation dedicated to one client company is
free (above), even if you operate many such installations, one per client.

Outputs do not change question 2 below: when AI Talk is the engine of **your product** serving several customer
businesses, that needs a commercial license even if those businesses and their customers only receive outputs.

"The client's own servers" include a cloud account that the client owns and contracts, even if you administer it.

Using AI Talk without a Business license key is free in all of the cases above. The `src/ee/` code ships
with the software, but its features stay off until a valid key is installed. Running the software without a key
does not require a Business license.

## Needs a commercial license from us

| Who | What |
|---|---|
| IT service providers, freelancers, agencies, trust companies, accounting firms and similar | **Several client companies** get **access** to one installation you run — for example their own logins to review their data, or screens to build or change workflows and Work Apps. |
| Service companies building on AI Talk | You run AI Talk behind your own product or screens to serve **several customer businesses** whose work and settings are kept apart in it (for example one booking assistant per restaurant). If those customer businesses can also change how the AI behaves (its instructions, conversation flows or rules), this needs an OEM agreement. |
| Anyone | Enabling the features in `src/ee/` (a Business license key). |

Three questions decide most cases:

1. Do **several** client companies get **access** to one installation you run — logins, its screens, or building
   or changing its workflows, Work Apps or how the AI behaves, through any screen, API, MCP or AI? If yes, it needs
   a commercial license. An installation dedicated to one client company is not this, and neither is temporary
   access during a workshop or training. Companies of the same group (as defined by "your company" in the license)
   count as one company.
2. Is AI Talk the engine behind **your product** that serves several customer businesses, with their work and
   settings kept apart in it? If yes, it needs a commercial license, even when only those businesses' own customers
   talk to the assistant. An installation dedicated to one client company and used only for that client's own
   business stays free (above). Doing the work yourself for your
   clients and handing over the outputs is not this. Neither is one company using AI Talk for its own customers and
   visitors — "your own customers and visitors" means the public of the one company that runs AI Talk for its own
   business.
3. Only if question 2 is yes: in that product, can those businesses **change how the AI behaves** (its
   instructions, conversation flows or rules) through any screen, API or AI? If yes, it needs an OEM agreement.

If questions 1 and 2 are no, it is free. Enabling the features in `src/ee/` always needs a valid Business license
key.

## Not allowed

- Selling AI Talk, or a modified or packaged version of it, as your own product. Using AI Talk as the engine behind
  your own product is question 2 and 3 above; that permission does not cover selling or distributing AI Talk itself.
- Offering AI Talk to several companies as a hosted service — where **those companies** log in, use its screens,
  or build or change its workflows, Work Apps or AI behavior — without a commercial license from us.
- Distributing AI Talk or a modified version for commercial purposes.
- Removing or hiding the license, copyright or other notices.
- Enabling `src/ee/` features without a valid key, or working around the key check.

## Other questions

**May we read and audit all of the code, including `src/ee/`?** Yes. Reading, reviewing and security
testing the code for your own evaluation is fine without a key. Under the Enterprise License you may also
copy and modify `src/ee/` for development and testing.

**What happens to our installation if M-BIZ Global AG stops?** An installation keeps running; it does not
call our servers and the license key is checked offline. Continuity terms for production use (for example
access to the last version and its sources) can be agreed in a Business license or support agreement — ask us.

**Do we have to send you our modifications?** No. The Sustainable Use License does not require you to
publish or send changes. If you distribute a modified copy (free of charge, for non-commercial purposes),
it must carry these license terms and a notice that you modified it.

**We are a freelancer or an agency. May we build and run AI Talk for our clients?** Yes, free of license fees.
You may install and operate it on each client's own servers, or build, run and maintain the clients' workflows and
Work Apps on your own installation, charge for that work, and reuse your own know-how from one client to the next —
as long as your clients receive outputs, not access. You may also run an installation on your servers dedicated to
one client, which that client's staff use. If several clients log in to one installation you run, or build or change
its workflows, Work Apps or AI behavior there, you need a commercial license from us. Selling AI Talk itself, or a
packaged version of it, as your product is not allowed.

**Third-party components** keep their own licenses — see [`NOTICE`](NOTICE).
