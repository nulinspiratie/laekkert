# Photos from the chat: upload links — design

Serwan asked whether Claude can attach a photo he shared in the Claude chat (a cookbook
page, a handwritten card, the dish he just made) to a recipe through the MCP. Today it
can't: `add_recipe` and `edit_recipe` take a photo only as a web link (`image_url`, or the
page photo behind `source_url`), and Claude can't set a source photo at all.
`docs/requirements-v1.md` already had this as an open question ("Test whether Claude can
upload a photo attached in chat, or only read it. The app's own upload button is the
fallback either way."). This spec answers it.

## What is possible (as of October 2026)

- **Not through an MCP tool call.** A tool's arguments are JSON; MCP has no file input yet
  (a File Uploads working group and drafts SEP-2356 / SEP-2631 exist, but nothing is in
  the 2026-07-28 spec). Claude could only pass the photo as base64 text it writes out token
  by token: a 3 MB photo is about 4 million characters. Not workable.
- **But the chat's sandbox has the file.** Serwan checked: in a claude.ai chat with code
  execution on, a photo he shares is also a file in Claude's workspace
  (`/mnt/user-data/uploads/`). Code there can send it over HTTP itself, so the bytes
  never pass through Claude's output or the MCP. The MCP only has to hand out a URL
  that the sandbox can upload to.

So: **the MCP gives Claude a short-lived upload URL, and Claude `curl`s the file to it
from its sandbox.** Two things outside the app have to allow it, and only Serwan can set
them:

1. **The sandbox's network.** Code execution's network access must be on and its domain
   allowlist must let `laekkert.serwan.me` through ("All domains", or the host added to
   the allowlist): claude.ai Settings → Capabilities.
2. **Cloudflare Access.** The sandbox has no Access login and no service token, and must
   not get one. The upload path skips Access with a Bypass policy; the one-time ticket in
   the URL is the credential (see Security).

When either is missing (network off, a client without code execution, a blocked host),
Claude falls back to a **photo link**: a page Serwan opens on his phone to pick the same
photo himself (Part 2).

## Goals

- Serwan shares a photo, says "add this" (or "put this on the recipe"), and the photo ends
  up on the recipe with no tap from him.
- Both photo slots: the recipe's **photo** (the dish) and its **source photo** (the
  cookbook page or card).
- When the direct upload can't work, one link and two taps on the phone do the same.
- Claude can set or remove the source photo from a web link too, as it already can the
  photo.

## Non-goals

- A base64 or other in-band photo argument on MCP tools.
- Giving the sandbox a Cloudflare Access service token or any long-lived secret.
- Uploading anything but one image to one slot of one existing recipe. No general file
  store, no creating recipes over the upload URL.
- Cropping, rotating or editing the photo (the editor doesn't either).

## Anti-goals (what would make it a failure)

- The upload URL works for anything other than the one slot it was made for, more than
  once, or after it expires.
- Anything else in the app becomes reachable without Access.
- An upload wipes a change made meanwhile to anything other than that one photo.
- Claude tells Serwan the photo is attached when the upload failed, or stays quiet about
  the fallback.

## The flow

1. Serwan shares a cookbook page in the chat: "add this".
2. Claude reads it, writes the recipe and calls `add_recipe`.
3. Claude calls `photo_upload_url(side, slug, slot="source")` and gets an upload URL.
4. In its sandbox Claude runs the `curl` command from the result on
   `/mnt/user-data/uploads/<file>`. The response says the photo is on the recipe.
5. Claude replies "Added *Pasta alla Norma*, with the page as its source photo: <link>".

If step 4 fails because the host is blocked or there is no sandbox, Claude calls
`photo_link(side, slug, slot="source")` and gives Serwan that link instead (Part 2). A
dish photo ("here's how it came out") is the same with `slot="photo"`.

---

## Part 1: Upload URLs

### MCP: `photo_upload_url(side, slug, slot: "photo" | "source" = "photo")`

> A one-time URL to upload a photo straight onto a recipe: `slot="photo"` for the dish,
> `slot="source"` for the page or card the recipe came from. Use it for a photo Serwan
> shared in the chat: it is a file in your code sandbox (look in /mnt/user-data/uploads),
> so run the returned curl command there on that file. Don't try to pass the photo to a
> tool. The URL works once, for 15 minutes. If the upload can't reach the app (no
> sandbox, network access off, host not allowed), give Serwan the link from photo_link
> instead and tell him why.

It mints a ticket and returns:

```json
{
  "side": "food",
  "slug": "pasta-alla-norma",
  "slot": "source",
  "has_photo": false,
  "upload_url": "https://laekkert.serwan.me/upload/photo/k3J9…",
  "expires_at": "2026-10-21T14:05:00Z",
  "max_bytes": 20971520,
  "curl": "curl -fsS -X PUT --data-binary @PHOTO 'https://laekkert.serwan.me/upload/photo/k3J9…'"
}
```

- The host comes from the `Host` header and goes through the same `HOST` check `saved()`
  uses. Without a usable host there is nothing to upload to: a `ToolError` saying so.
- An unknown recipe is a `ToolError` in the wording `edit_recipe` uses.
- The tool writes nothing to the recipe.

### Tickets

- 32 random bytes (`secrets.token_urlsafe(32)`). The server keeps only their SHA-256, with
  side, slug, slot and expiry.
- Kept in memory in the app process: 15 minutes, used once, at most 20 live (minting a
  21st drops the oldest). A restart or deploy forgets them; Claude just asks for a new
  one. Nothing goes to `/data`.
- A ticket counts as used once an upload with it succeeds. A failed upload (wrong type,
  too big) leaves it usable, up to 3 tries.

### The upload endpoint: `PUT /upload/photo/{ticket}`

Outside `/api/` on purpose, so the Access Bypass policy can cover exactly this prefix and
nothing else.

- The body is the raw image bytes. The type is read from the first bytes
  (`UploadStore.save_detected`), so Claude doesn't need to guess a content type; the same
  checks as every upload apply (JPEG, PNG, WebP, GIF, AVIF, HEIC; no SVG or HTML; 20 MB,
  enforced while reading with the API's `read_body`).
- Then it puts the photo in that slot as a one-field change: under the store's lock, read
  the latest version, swap `image` (or `source.photo`, keeping `source.url`), and
  `store.update(..., "claude", base_version=latest)`. History shows "source photo added"
  or "photo replaced" as written by Claude, as the diff already words it.
- Responses (JSON, no cookies, no CORS headers):
  - `200 {"side", "slug", "slot", "version", "link"}`: done.
  - `404 {"error": "This upload link is unknown or has expired"}`: unknown, expired or
    used ticket, all alike so the response gives nothing away.
  - `410` once the recipe was deleted since the ticket was made.
  - `413` too big, `415` not a supported photo, `503` save failed: the API's existing
    messages.
- Only `PUT`. Any other method on `/upload/...` is 405. `GET /upload/...` must not fall
  through to the SPA.

### Cloudflare (Serwan, once)

In Zero Trust → Access → Applications, add a self-hosted application for
`laekkert.serwan.me/upload/photo` with one policy: **Bypass, Everyone**. The more specific
path wins over the app's main Access application; everything else stays behind the login.
The tunnel route doesn't change.

### Claude's sandbox (Serwan, once)

claude.ai Settings → Capabilities: code execution on, network access on, and either
"All domains" or `laekkert.serwan.me` added to the allowlist. (On a Team or Enterprise
plan the organization owner sets this.)

---

## Part 2: The photo link (fallback)

For when the sandbox can't reach the app. A plain page address, no ticket: it sits behind
Access like the rest of the app, and Serwan's phone is already signed in.

### MCP: `photo_link(side, slug, slot: "photo" | "source" = "photo")`

Read-only. Returns `{side, slug, name, slot, has_photo, path, link}`, with
`link = https://<host>/<side>/<slug>/photo?slot=<slot>` (same `HOST` check; left out
without a usable host).

> A link Serwan opens on his phone to add or replace a recipe's photo or source photo
> himself. Use it when photo_upload_url's upload can't reach the app.

### The photo page (`/:side/:slug/photo?slot=photo|source`)

A new SPA route, phone first, built from the editor's Photo card (`FilePick`, preview).
A missing or unknown `slot` means `photo`.

- Header: the recipe's name, then "Photo" or "Source photo". Back goes to the recipe.
- The current photo for that slot (or the dish-icon tile, or an empty frame for source),
  then one big **Choose photo** / **Replace photo** button
  (`<input type="file" accept="image/*">`, no `capture`, so the phone offers both the
  library and the camera).
- After picking: the preview uploads (`POST /api/uploads`), then **Save** and **Pick
  another**. Save is disabled until the upload is done.
- Save `PUT`s the recipe as last loaded with only that slot changed, with
  `base_version`. On 409 it reloads, reapplies the one change and saves once more; a
  second 409 says "The recipe changed while saving; try again". Success shows "Saved" and
  **View recipe**.
- An unknown recipe shows the app's not-found view. No new endpoints: the server already
  serves `index.html` for any GET path that isn't a built file.

---

## Part 3: Source photo from a web link

`add_recipe` and `edit_recipe` get `source_photo_url`; `edit_recipe` also gets
`remove_source_photo`. They work like `image_url` and `remove_image`: same `Fetcher`
guards (http/https on 80/443, public addresses only) and upload checks; a failed fetch
saves without it and warns (on edit the old one stays); the URL and remove together are
refused; `remove_source_photo` keeps `source.url`, and with neither left `source` is
`null`. Write results get `"source_photo": true|false` next to `"photo"`. This is for a
scan Claude finds online, not for a chat photo.

## Instructions and style guide

- `INSTRUCTIONS`: "A photo shared in the chat is a file in your code sandbox: attach it
  with photo_upload_url, or if that can't reach the app, give Serwan the photo_link."
- `style_guide.md`, "Sources and photos", **From a photo in the chat** becomes: read it
  and write the recipe from it, then attach the same photo as the source photo with
  `photo_upload_url` and `curl` from your sandbox. For a photo of the finished dish use
  `slot="photo"`. If the upload fails, say why and give the `photo_link`. Never say the
  photo is attached unless the upload returned 200.
- `add_recipe` and `edit_recipe` mention `source_photo_url` in the words `image_url` uses,
  and: "A photo from the chat can't be passed here; see photo_upload_url."

## Security

The upload endpoint is the app's first path outside Access. What keeps it narrow:

- It accepts nothing without a live ticket, and tickets come only from the MCP, which
  stays behind Access (Claude's service token).
- A ticket is 256 bits, stored hashed, used once, lasts 15 minutes and is bound to one
  slot of one recipe. Seeing one in a chat transcript after the fact gets you nothing.
- It can only swap one photo: it can't read a recipe, change any text, create or delete a
  recipe, or keep a file anywhere but that recipe's folder.
- The body goes through the upload checks every photo already gets (type from the first
  bytes, raster formats only, 20 MB while reading), so it can't plant HTML or SVG to be
  served from the app's origin.
- Unknown, expired and used tickets get the same 404. Only `PUT`, no cookies, no CORS, so
  a web page can't use it from someone's browser.
- The Access Bypass covers exactly `/upload/photo`; a test checks no other route is
  mounted under `/upload/`.

## Deploying and rollback

Merging to `main` deploys; no file format change (`source.photo` exists already). Part 1
does nothing until Serwan adds the Bypass application and the sandbox allowlist. Until
then the upload gets the Access login page or a blocked-host error, and Claude falls
back to the photo link. Rolling back removes the endpoint, the page and the tools. Then
delete the Bypass application: with no route under it, it is harmless but pointless.

## Testing

- Python:
  - `photo_upload_url`: both slots, the URL and the `curl` text, a bad host, an unknown
    recipe.
  - Tickets: expiry (with a fake clock), used once, 3 failed tries, the 20-ticket cap,
    only the hash kept.
  - `PUT /upload/photo/{ticket}`: JPEG and HEIC into each slot, the change is one field
    and keeps `source.url`, history by Claude, a concurrent edit isn't lost, 404s for
    unknown, expired and used tickets look the same, 410 for a deleted recipe, 413, 415
    for SVG and HTML bodies, 405 for other methods, `GET /upload/...` isn't the SPA.
  - `photo_link`; `source_photo_url` and `remove_source_photo` on add and edit, as in
    the existing `image_url` tests.
- Web (`PhotoPage.test.tsx`): the slot from the query, pick and Save sends only that
  field, the 409 retry, upload errors, not found.
- `just lint` and `just test` pass; phone and desktop screenshots of the photo page in
  `docs/design/screenshots/photo-link/`.
- By hand after deploy and the two settings: in the Claude app on the phone, share a
  cookbook photo, have Claude add the recipe, see the source photo on it. Then turn the
  host off in the allowlist and check that Claude falls back to the link.

## Left to the builder

- Where the ticket store lives (a small module next to `uploads.py` is expected) and how
  it is shared between the MCP and the route.
- The photo page's exact CSS within the editor's look and the drinks theme.
- Test file layout.

## For Serwan to decide

- **The Access Bypass.** It is the price of a no-tap upload. Without it, only Part 2
  (two taps) works, and Part 1 shouldn't be built.
- **Build Part 2 now or later?** It is the fallback for a phone chat without code
  execution or with the host blocked. It can wait if the sandbox route proves reliable.
- **Upload before the recipe exists?** This spec attaches to an existing recipe (add, then
  upload). A ticket for "the next `add_recipe`" would save one call but makes tickets
  harder to reason about.
- **Revisit when MCP file inputs land** and the Claude apps pass chat attachments to
  connectors: then `add_recipe` can take the photo directly and the Bypass can go.
