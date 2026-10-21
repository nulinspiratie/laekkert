# Source photos and photos from the chat — design

Serwan wants Claude to attach the photos a recipe comes with: the cookbook page, card or
screenshot it was written from (the **source photo**), and a photo of the dish he shares
(the **photo**). Today Claude can't do either: `add_recipe` and `edit_recipe` take a photo
only as a web link (`image_url`, or the page photo behind `source_url`), can't set a source
photo at all, and have no way to take a photo shared in the chat. `docs/requirements-v1.md`
had this as an open question ("Test whether Claude can upload a photo attached in chat, or
only read it").

## What Serwan decided

- **No new MCP tools.** Everything is optional arguments on `add_recipe` and
  `edit_recipe`, so attaching a photo never costs an extra tool call.
- **`source_url` may be an image.** If the link is an image rather than a web page, the app
  downloads it as the source photo.
- **Chat photos go up from Claude's sandbox** (option 1 of the options discussed): the write
  result carries a one-time upload URL, and Claude `curl`s the file to it from its code
  sandbox, where a photo shared in the chat is a file (`/mnt/user-data/uploads/`; Serwan
  checked).
- The style guide tells Claude to attach source photos whenever there is one.

## Why the chat photo can't go through the MCP itself (as of October 2026)

- MCP tool arguments are JSON; there is no file input (a File Uploads working group and
  drafts SEP-2356 / SEP-2631 exist, but nothing is in the 2026-07-28 spec).
- Claude can't pass the photo as text: base64 of a 3 MB photo is about 4 million characters
  written out token by token.
- Claude can't turn the photo into a link the app could fetch: a chat file on claude.ai is
  only reachable with Serwan's claude.ai login. A public file host would work but puts his
  photos on a stranger's service; rejected.

The sandbox route needs two settings outside the app, both Serwan's (see "Setup").

## Goals

- Serwan shares a cookbook page and says "add this": the recipe is saved with the page as
  its source photo, with no tap from him.
- He shares a photo of the dish: it becomes the recipe's photo the same way.
- A link to a scan or image online becomes the source photo by passing it as `source_url`.
- Claude attaches a source photo whenever one is available, without being asked.
- When the upload can't work, Claude says so plainly and points to the editor.

## Non-goals

- New MCP tools (`photo_upload_url`, `photo_link` and the like).
- A base64 or other in-band photo argument.
- Giving the sandbox a Cloudflare Access service token or any long-lived secret.
- A separate phone page for adding a photo; the editor already does it. (Left for later.)
- More than one photo per slot. Cropping or rotating.

## Anti-goals (what would make it a failure)

- An upload URL that works for more than its one slot, more than once, or after expiry.
- Anything else in the app reachable without Access.
- An upload that wipes a change made meanwhile to anything but that one photo.
- Claude saying a photo is attached when the upload failed.
- A recipe written from a photo in the chat ending up without that photo, and nobody
  told.

## The flow

1. Serwan shares a cookbook page in the chat: "add this".
2. Claude reads it, writes the recipe and calls
   `add_recipe(side, recipe, upload_photos=["source"])`.
3. The result has the recipe as today plus an `uploads` entry with a one-time URL and a
   `curl` command.
4. In its sandbox Claude runs the command on `/mnt/user-data/uploads/<file>`. The
   response says the photo is on the recipe.
5. Claude replies: "Added *Pasta alla Norma*, with the page as its source photo: <link>".

If step 4 fails (no sandbox, network access off, host blocked, Access login page),
Claude says the recipe is saved without the photo, why, and that Serwan can add it in the
editor (`<link>/edit`).

## MCP changes

### `source_url` may be an image (`add_recipe`, and `changes.source_url` in `edit_recipe`)

The app fetches the link once (the `Fetcher`'s existing guards: http/https, ports 80/443,
public addresses only; read up to 20 MB) and looks at the first bytes:

- **An image** (the upload checks: JPEG, PNG, WebP, GIF, AVIF, HEIC; never SVG or HTML):
  saved as the source photo. `source.url` keeps the link too, so "already saved" still
  works. The recipe gets no dish photo from it; `image_url` still sets that.
- **Anything else:** a web page, as today. In `add_recipe` its main photo becomes the
  recipe's photo (unless `image_url` is given). In `edit_recipe` a page link is only saved,
  as today; nothing is fetched.
- **The fetch fails:** in `add_recipe` the recipe is still saved with the link and a
  warning, as today. In `edit_recipe` the link is saved and the old source photo stays,
  with a warning.

In `edit_recipe`, `changes.source_url = null` keeps the source photo, as today.

### `edit_recipe(..., remove_source_photo: bool = False)`

Removes the source photo and keeps `source.url`; with neither left, `source` is `null`.
Refused together with an image `source_url` or `upload_photos` containing `"source"`,
like `image_url` with `remove_image`.

### `upload_photos: list["photo" | "source"] = []` (`add_recipe` and `edit_recipe`)

Asks for one-time upload URLs, one per slot, at most one of each. The recipe is saved
first (or, in `edit_recipe` with nothing else in `changes`, not saved at all: the version
stays); then the tickets are minted, so a refused save never leaves a ticket. The result
gets:

```json
"uploads": [
  {
    "slot": "source",
    "url": "https://laekkert.serwan.me/upload/photo/k3J9…",
    "expires_at": "2026-10-21T14:05:00Z",
    "curl": "curl -fsS -X PUT --data-binary @PHOTO 'https://laekkert.serwan.me/upload/photo/k3J9…'"
  }
]
```

- `"photo"` together with `image_url`, or with `remove_image`, is refused ("pass one").
  `"source"` together with a `source_url` that turns out to be an image: the upload simply
  replaces it when it arrives.
- The host comes from the `Host` header through the same `HOST` check `saved()` uses.
  Without a usable host, `uploads` is empty and a warning says the upload URL couldn't be
  made.
- The write result's other fields stay as they are; `photo` (bool) is joined by
  `source_photo` (bool), both as saved before any upload.

### Tool descriptions

- `add_recipe`, after the `image_url` sentence: "source_url may also be a direct link to an
  image (a scan or photo of the recipe): it is saved as the source photo. For a photo
  shared in the chat, pass upload_photos (`"source"` for the page or card the recipe
  came from, `"photo"` for the dish) and run the returned curl command in your code
  sandbox on that file. The URL works once, for 15 minutes."
- `edit_recipe`: the same for `upload_photos` and image links in `changes.source_url`, plus
  `remove_source_photo`. With only `upload_photos`, pass empty `changes`.
- `INSTRUCTIONS`, one more sentence: "Attach a recipe's source photo whenever there is one
  (see the style guide)."

## The upload endpoint: `PUT /upload/photo/{ticket}`

Outside `/api/` on purpose, so a Cloudflare Access Bypass covers exactly this prefix.

### Tickets

- 32 random bytes (`secrets.token_urlsafe(32)`); the server keeps only their SHA-256, with
  side, slug, slot and expiry.
- In memory in the app process: 15 minutes, used once, at most 20 live (the oldest drops).
  A restart or deploy forgets them; Claude can ask again with `edit_recipe`.
- Used once an upload with it succeeds. A failed upload (wrong type, too big) leaves it
  usable, up to 3 tries.

### The request

- The body is the raw image. Its type is read from the first bytes
  (`UploadStore.save_detected`), so no content type is needed; the usual checks apply
  (raster types only, 20 MB enforced while reading with the API's `read_body`).
- The photo goes into its slot as a one-field change: under the store's lock, read the
  latest version, swap `image` (or `source.photo`, keeping `source.url`), and
  `store.update(..., "claude", base_version=latest)`. History shows "source photo added"
  or "photo replaced" by Claude, in the diff's existing words.
- Responses (JSON; no cookies, no CORS headers):
  - `200 {"side", "slug", "slot", "version", "link"}`.
  - `404 {"error": "This upload link is unknown or has expired"}` for unknown, expired
    and used tickets alike.
  - `410` when the recipe was deleted since; `413`, `415`, `503` with the API's existing
    messages.
- Only `PUT`; other methods are 405, and `GET /upload/...` does not fall through to the
  SPA.

## Setup (Serwan, once)

1. **Cloudflare:** Zero Trust → Access → Applications, a self-hosted application for
   `laekkert.serwan.me/upload/photo` with one policy, **Bypass, Everyone**. The more
   specific path wins over the app's main Access application; everything else stays behind
   the login.
2. **claude.ai:** Settings → Capabilities: code execution on, network access on, and
   either "All domains" or `laekkert.serwan.me` on the allowlist (on a Team or Enterprise
   plan, the organization owner sets this).

Until both are done, uploads fail and Claude falls back as described. Image links in
`source_url` work without either.

## Style guide

`src/app/style_guide.md`, "Sources and photos" is replaced by this. It ships with the code,
not before: the current guide must not describe arguments the app doesn't have yet.

```markdown
## Sources and photos

A recipe has two photo slots: the **photo** (the dish, shown on cards and at the top) and
the **source photo** (what the recipe was written from: a cookbook page, a card, a
screenshot). Attach a source photo whenever one is available; Serwan wants to see the
original next to the recipe.

- **From a web page:** fetch the page yourself, write the recipe from it in this style,
  and pass the page's address as `source_url`. The app saves the link and takes the page's
  main photo as the recipe's photo by itself.
- **From an image online** (a scan of a cookbook page, a photo of a card, a screenshot):
  pass the image's direct address as `source_url`. The app saves it as the source photo.
- **From a photo in the chat** (a cookbook page, a handwritten card, a screenshot): read
  it and write the recipe from it, and pass `upload_photos: ["source"]`. Then run the
  `curl` command from the result in your code sandbox on that file (shared files are in
  `/mnt/user-data/uploads/`). Several photos for one recipe (two pages): upload the first
  page, and say the others weren't attached.
- **A photo of the dish in the chat:** `upload_photos: ["photo"]` the same way; a shared
  page and a dish photo together: `["source", "photo"]`.
- **Adding a photo later:** `edit_recipe` with empty `changes` and `upload_photos`.
- **Say what happened.** Only say a photo is attached when the upload answered 200. If it
  failed (no sandbox, network blocked, the link expired), say the recipe is saved without
  it, why, and that Serwan can add it in the editor (the recipe's link plus `/edit`).
- **Photo rule:** the app is private (just Serwan and his partner, behind a login), so any
  photo is fine. For a recipe from a web page, the app uses the page's own photo; pass an
  `image_url` only if you found a better one. For a recipe with no photo of the dish (an
  idea, one you wrote, one from a cookbook page), look for a photo on the web that shows
  the dish well and pass its direct image address as `image_url`. No photo is fine too:
  recipes without one look intentional. A source photo is never used as the dish photo.
```

## Security

The upload path is the app's first route outside Access. What keeps it narrow:

- Nothing is accepted without a live ticket, and tickets come only from `add_recipe` and
  `edit_recipe`, which stay behind Access (Claude's service token).
- A ticket is 256 bits, stored hashed, used once, lasts 15 minutes and is bound to one
  slot of one recipe. One seen later in a chat transcript is worthless.
- It can only swap one photo: it can't read a recipe, change text, create or delete
  anything, or put a file anywhere but that recipe's folder.
- The body goes through the checks every photo already gets (type from the first bytes,
  raster only, 20 MB while reading), so it can't plant HTML or SVG on the app's origin.
- The same 404 for unknown, expired and used tickets; only `PUT`; no cookies or CORS, so
  a web page can't drive it from someone's browser.
- A test checks that no other route is mounted under `/upload/`.
- Image `source_url`s use the `Fetcher`'s existing guards (public addresses, 80/443).

## Deploying and rollback

Merging to `main` deploys; no file format change (`source.photo` exists already). Image
links in `source_url` work at once; uploads after the setup above. Rolling back removes the
endpoint and the arguments, and the old style guide comes back with them, so Claude stops
asking for uploads. Then delete the Bypass application; with no route under it, it is
harmless but pointless.

## Testing

- Python:
  - `source_url` as an image (add: source photo set, link kept, no dish photo from it;
    edit: same), as a page (unchanged behaviour), an SVG or HTML body labelled as an image,
    a failed fetch (saved with the warning), "already saved" with an image link.
  - `remove_source_photo` (keeps the link; with none, `source` is `null`) and its
    refusals.
  - `upload_photos`: one and both slots, a duplicate slot refused, `"photo"` with
    `image_url` refused, `edit_recipe` with empty `changes` doesn't bump the version, a
    refused save mints nothing, a bad host gives the warning.
  - Tickets: expiry (fake clock), used once, 3 failed tries, the cap of 20, only hashes
    kept.
  - `PUT /upload/photo/{ticket}`: JPEG and HEIC into each slot, a one-field change that
    keeps `source.url`, history by Claude, a concurrent edit isn't lost, identical 404s,
    410, 413, 415 (SVG, HTML), 405, `GET /upload/...` isn't the SPA, nothing else under
    `/upload/`.
- `just lint` and `just test` pass.
- By hand after deploy and setup: in the Claude app on the phone, share a cookbook page,
  "add this", and see the source photo on the recipe. Then block the host in the
  allowlist and check that Claude says the photo wasn't attached and points to the editor.

## Left to the builder

- Where the ticket store lives (a module next to `uploads.py` is expected) and how the MCP
  and the route share it.
- How the one fetch for `source_url` is split between page and image (one GET read up to
  the image limit, then sniffed, is expected).
- Test file layout.

## For Serwan to decide

- **The Access Bypass on `/upload/photo`.** It is the price of a no-tap upload. Without
  it, only image links in `source_url` work, and the upload part shouldn't be built.
- **A one-tap phone page** for when the upload can't work, instead of the editor. Left out
  for now.
- **Several source photos** (a recipe over two cookbook pages). The file format has one;
  more would need a format change.
- **Revisit when MCP file inputs land** and the Claude apps pass chat attachments to
  connectors: then the photo can go straight into `add_recipe` and the Bypass can go.
