# Photos from the chat: the photo link — design

Serwan asked whether Claude can attach a photo he shared in the Claude chat (a cookbook
page, a handwritten card, the dish he just made) to a recipe through the MCP, and if so
for a spec. Today it can't: `add_recipe` and `edit_recipe` take a photo only as a link
(`image_url`, or the page photo behind `source_url`), and Claude can't set a source photo
at all. `docs/requirements-v1.md` already had this as an open question ("Test whether
Claude can upload a photo attached in chat, or only read it. The app's own upload button
is the fallback either way."). This spec answers it and designs the fallback.

## Why it can't be a straight upload (as of October 2026)

Two separate limits, and both would have to go before an MCP tool could take the photo
itself.

1. **MCP has no file input.** A tool's arguments are JSON. There is no file type and no
   way for the client to hand the server a chat attachment. A File Uploads working group
   exists and drafts (SEP-1306, then SEP-2356 and SEP-2631) are open, but none is in the
   2026-07-28 spec; the maintainers deferred it. Elicitation, the one way a server asks the
   user for something, takes text, numbers and choices, and the URL mode only opens a link.
   Neither carries a file.
2. **Claude can't hand on the photo's bytes.** A photo in the chat reaches Claude as
   something it sees, not as a file it holds. Claude can read the recipe off it but
   can't copy the file into a tool call. The only way to pass bytes as JSON would be
   base64 text, and Claude would have to write it out one token at a time: a 3 MB phone
   photo is about 4 million characters. That is far too slow and costly, and longer than
   a reply can be. Claude.ai's code sandbox does hold uploaded files, but it can't reach
   the app: its network is locked down and the app sits behind Cloudflare Access.

So a direct upload isn't possible today. When MCP gets file inputs **and** the Claude apps
pass chat attachments to connectors, a `photo` argument can be added next to `image_url`.
Until then the photo has to come from Serwan's own phone, and the job is to make that one
tap.

## Goals

- When Serwan shares a photo in the chat and wants it on a recipe, Claude gives him a link.
  He taps it, picks the same photo from his camera roll (or takes one), checks the
  preview, taps Save, and he's done. No hunting for the recipe, no editor, no form.
- It works for both photo slots: the recipe's **photo** (the dish) and its **source
  photo** (the cookbook page or card the recipe came from).
- Claude can set or remove the source photo from a link too, as it already can the photo.
- Nothing new can write to recipes: the page uses the API the editor already uses, behind
  the same Cloudflare Access login.

## Non-goals

- Uploading the photo's bytes through MCP (see above). No base64 argument either: it
  would only work for tiny images and would invite Claude to try with real ones.
- Upload tickets, tokens or any state kept on the server for a link. The link is a plain
  page address.
- Claude seeing whether Serwan used the link. He sees the result; Claude can
  `read_recipe` if asked.
- Cropping, rotating or editing the photo (the editor doesn't either).
- More than one photo per slot.

## Anti-goals (what would make it a failure)

- The link opens the full editor, or a page with more than one decision before Save.
- A save through the link wipes a change made meanwhile (by Claude, the other phone or the
  editor) to anything other than that one photo.
- A new endpoint that accepts writes, or a way in that skips Cloudflare Access.
- The style guide still tells Claude it can't help with a chat photo.

## The flow

1. Serwan shares a cookbook page in the chat: "add this".
2. Claude reads it, writes the recipe and calls `add_recipe`. The result has `slug` and
   `link` as today.
3. Claude calls `photo_link(side, slug, slot="source")` and replies, for example:
   "Added *Pasta alla Norma*. Tap here to attach the page as its source photo:
   https://laekkert.serwan.me/food/pasta-alla-norma/photo?slot=source".
4. On the phone the link opens the photo page (Access is already signed in there). He taps
   **Choose photo**, the phone offers Photo Library / Take Photo / Choose File, he picks
   it, sees the preview and taps **Save**. The page says it's saved and shows a link
   back to the recipe.

The same works for a dish photo ("here's how it came out"): `slot="photo"`. Claude can
also call `photo_link` for a recipe that already exists.

## MCP

### `photo_link(side, slug, slot: "photo" | "source" = "photo")`

Read-only; it changes nothing.

> A link Serwan opens on his phone to add or replace a recipe's photo (`slot="photo"`:
> the dish) or source photo (`slot="source"`: the page or card the recipe came from).
> Use it when he shares a photo in the chat that belongs on a recipe: you can't attach a
> photo from the chat yourself, so add the recipe first, then give him this link.

Returns:

```json
{
  "side": "food",
  "slug": "pasta-alla-norma",
  "name": "Pasta alla Norma",
  "slot": "source",
  "has_photo": false,
  "path": "/food/pasta-alla-norma/photo?slot=source",
  "link": "https://laekkert.serwan.me/food/pasta-alla-norma/photo?slot=source"
}
```

- `link` is built from the `Host` header exactly as `saved()` builds it (same `HOST`
  check). Without a usable host it is left out, as there.
- `has_photo` says whether that slot already has one, so Claude can say "replace" rather
  than "add".
- An unknown recipe is a `ToolError` in the wording `edit_recipe` uses.

### Source photo from a link

`add_recipe` and `edit_recipe` get `source_photo_url`; `edit_recipe` also gets
`remove_source_photo`. They work like `image_url` and `remove_image`:

- The photo is fetched with the same `Fetcher.image` and `UploadStore.save_detected`, so
  the same checks apply (type from its first bytes, 20 MB, no SVG or HTML).
- If it can't be fetched the recipe is still saved, with a warning
  (`"Saved without the source photo: ..."`); on edit the old source photo stays.
- `source_photo_url` and `remove_source_photo` together are refused, like
  `image_url` and `remove_image`.
- In `edit_recipe`, `changes.source_url = null` still keeps the source photo (as today).
  `remove_source_photo` removes it and keeps the link. With neither left,
  `source` becomes `null`.
- `add_recipe` may take `source_url` and `source_photo_url` together: the link and a
  scan of the page.
- The write result gets `"source_photo": true|false` next to `"photo"`.

This is for a scan or photo Claude finds online (a cookbook page on a blog, say). It
doesn't help with a chat photo; `photo_link` does.

### Instructions and style guide

- `INSTRUCTIONS` gets one sentence: "A photo shared in the chat can't be attached
  directly; give Serwan the link from photo_link to add it from his phone."
- `style_guide.md`, "Sources and photos": the **From a photo in the chat** bullet becomes:
  read it and write the recipe from it, then call `photo_link` with `slot="source"` and
  give Serwan the link so he can attach the same photo. For a photo of the finished dish,
  use `slot="photo"`. Don't describe or summarise the photo instead of giving the link.
- `add_recipe`'s and `edit_recipe`'s descriptions mention `source_photo_url` in the same
  words as `image_url`. `add_recipe` adds: "A photo from the chat can't be passed here; see
  photo_link."

## The photo page (`/:side/:slug/photo?slot=photo|source`)

A new SPA route, phone first. A missing or unknown `slot` means `photo`. It reuses the
editor's `FilePick` and preview, so it looks like the editor's Photo card on its own.

- **Header:** the recipe's name; under it "Photo" or "Source photo". Back goes to the
  recipe page.
- **Body:** the current photo for that slot if there is one (or the dish-icon tile for an
  empty photo slot, a plain empty frame for source), then one big button: **Choose photo**
  / **Replace photo** (`<input type="file" accept="image/*">`, no `capture`, so the
  phone offers both the library and the camera).
- **After picking:** the preview replaces the current photo while it uploads
  (`POST /api/uploads`, as the editor does). Then **Save** and **Pick another**. Save is
  disabled until the upload is done. Upload errors (type, 20 MB) show in the editor's
  words.
- **Save:** builds the draft from the recipe as last loaded with only that slot changed
  (`image`, or `source.photo` keeping `source.url`), and `PUT`s it with `base_version`.
  - On **409**, it reloads the recipe, applies the same one-field change to the new
    version and saves once more. Only that slot changes, so this is safe; a second 409
    shows "The recipe changed while saving; try again".
  - Success: "Saved" with **View recipe** (goes to `/:side/:slug`). History shows "source
    photo added" or "photo replaced" via the web, as the diff already words it.
- **Unknown recipe:** the app's not-found view.
- **Desktop:** the same page, centred in the editor's card width.

The recipe page gets nothing new: the editor still covers adding photos when Serwan
browses there himself. (A small "Add source photo" link on a recipe page without one is
left to Serwan; see the end.)

## API and server

- No new endpoints. The page uses `GET` and `PUT /api/recipes/{side}/{slug}` and
  `POST /api/uploads`, as the editor does.
- The server already serves `index.html` for any GET path that isn't a built file
  (`web.py`), so `/:side/:slug/photo` needs no server change.
- MCP: `photo_link` in `mcp_server.py` next to `edit_recipe`. `fetch_photo` is reused for
  `source_photo_url`; `merged()` takes the source photo the same way it takes `image`.

## Security

- The link is a page address, not a capability: without Serwan's Cloudflare Access login
  it shows the Access sign-in, like every other page. Leaking it leaks a recipe slug.
- Writes go through the existing upload checks (type from the first bytes, 20 MB,
  parked under a random name, moved in only on save) and the existing recipe `PUT`.
- `source_photo_url` goes through the same `Fetcher` as `image_url`, with its existing
  guards (http/https on 80/443 only, public addresses only).

## Deploying and rollback

Merging to `main` deploys. No file format change: `source.photo` exists since format 1.
Rolling back removes the page and the tool; links already given then show the app's
not-found view. Nothing to migrate.

## Testing

- Python (`tests/test_mcp_writes.py` or a new `tests/test_mcp_photos.py`):
  - `photo_link` for both slots, `has_photo`, link with a good host and without one,
    unknown recipe, an unknown slot refused by the schema.
  - `add_recipe` with `source_photo_url` (saved, `source_photo: true`), with a failing
    fetch (saved with the warning), with `source_url` and `source_photo_url` together.
  - `edit_recipe` with `source_photo_url` (replaced; failing fetch keeps the old one),
    `remove_source_photo` (keeps the URL; with no URL `source` is `null`), both together
    refused, `changes.source_url = null` still keeps the photo.
  - The diff lines for source photo added, replaced, removed through MCP.
- Web (`PhotoPage.test.tsx`): the slot from the query (and the default), the current
  photo shown, pick then Save sends only that field with `base_version`, a 409 reloads
  and retries once, a second 409 shows the message, upload errors, Save disabled while
  uploading, not found.
- `just lint` and `just test` pass. Phone and desktop screenshots of the page (empty,
  picked, saved) in `docs/design/screenshots/photo-link/`.
- By hand after deploy: share a cookbook photo in the Claude app on the phone, have
  Claude add the recipe, tap the link, pick the photo, save, see it on the recipe.

## Left to the builder

- The page's exact CSS within the editor's Photo card look and the drinks theme.
- Whether the page and the editor share one photo-slot component or the page wraps the
  editor's.
- Test file layout.

## For Serwan to decide

- **Save on pick, or preview then Save?** This spec has a preview and Save (one more tap,
  but a wrong pick costs nothing). Saving on pick is one tap fewer.
- **An "Add source photo" link on the recipe page** when a recipe has none. It's handy
  in the app too, but it's an addition to a screen that is designed already.
- **Revisit when MCP file inputs land.** Once the spec has them and the Claude apps pass
  chat attachments to connectors, `add_recipe` and `edit_recipe` can take `photo` and
  `source_photo` directly and the link becomes the fallback.
