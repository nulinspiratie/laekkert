# Ingredient groups, step groups and recipe notes — design

Serwan asked for three upgrades to recipes. There is no Claude Design session: the screens
reuse the recipe page and editor patterns M1 and M2 already have. Mockups Serwan agreed to
(phone, food side): https://claude.ai/artifact/AwE5M24pKahuv58KgWFCGg — a grouped recipe
with one step count, the rejected per-group count, and a recipe with no groups.

## Why

- **Groups.** Longer recipes have parts. The ingredients for a marinade, a sauce and the
  thing that goes on the plate read better apart, and so does the method. For a long meal
  the method is often best split by *when* ("The day before", "An hour before", "To
  serve") rather than by *what*. It depends on the recipe, so the app doesn't decide.
- **Notes.** Some things aren't steps: what keeps, what to make ahead, a swap that
  worked, a warning. They belong at the bottom of the recipe, written with line breaks and
  the odd bold or italic word, and sometimes a short list.

## What Serwan decided

- The page shows all the ingredients first, separated by group, then the method, which has
  its own groups.
- Step groups and ingredient groups are independent: their headings don't need to match.
  Ingredients may be grouped by thing and steps by time, or both by thing, or only one of
  the two grouped.
- Many recipes have no groups, and must look exactly as they do today.
- A note at the bottom of the recipe, supporting new lines and bold text. After reading
  the spec he added italics and bullets.

Agreed from the mockups (proposed by Claude, accepted with "looks good"):

- Step numbers run through the whole method (1–6), not restarting in each group.
- Rows with no group come first, with no heading, then the groups.
- Claude (MCP) can set groups and notes when it adds or edits a recipe, and the style guide
  says when to.
- The Notes section shows only when a recipe has notes.

## Goals

- A recipe can group its ingredient rows and, separately, its steps under short headings.
- A recipe can have notes: plain text with line breaks kept, `**bold**`, `*italic*` and
  bullet lines (see "Notes formatting").
- The app's editor and Claude's tools can set both; history shows the changes.
- Existing recipes on the NAS keep working with no manual step.

## Non-goals

- Any formatting in notes besides line breaks, bold, italics and bullets: no links,
  headings, numbered lists, nested lists or Markdown in general.
- Formatting in steps or ingredient notes.
- Nested groups, collapsible groups, group-level scaling or "make only the sauce".
- Linking an ingredient group to a step group.
- Searching notes or group names.
- Changing the timeline's dated notes (History). Those stay as they are; recipe notes are
  part of the recipe and versioned with it.

## Anti-goals (what would make it a failure)

- A recipe without groups or notes looks or behaves any differently, on any screen.
- Scaling, the tsp / g-ml toggle, the drinks bar buttons, "what you have" matching or
  ingredient merging behave differently for a grouped row.
- Notes are rendered as HTML, so text in them can inject markup.
- An existing recipe file stops loading, or an old version can't be restored.
- Editing a grouped recipe in the app loses its groups, or reorders rows across groups
  without the person moving them.

## The recipe file: format 3

`FORMAT_VERSION` goes from 2 to 3 (`src/app/recipes/model.py`).

- **Ingredient** gains `group: str = ""` (at most 60 characters). `""` is no group.
- **Steps** become objects: `steps: list[Step]`, `Step = {text: str (min 1), group: str =
  ""}` (group at most 60 characters). A string can't carry a group, and the two lists must
  be grouped independently, so both get the same per-row field.
- **Recipe** gains `notes: str = ""` (at most 5000 characters), after `steps`.
- Group membership is the `group` field; order is list order. A group's rows are expected
  to sit together. When they don't (a hand-edited file with `A, B, A`), the page shows a
  heading for each consecutive run (`A`, `B`, `A`); nothing re-sorts rows.
- Rows with no group *after* a group (`Marinade: a, b`, then ungrouped `c`) are valid and
  kept as they are (Claude's call: refusing them would make the editor's blank heading
  an error, and re-sorting is ruled out). The page gives such a run the heading's rule
  with no text, so `c` doesn't read as part of Marinade.
- **Migration 2 → 3** in `MIGRATIONS`: each string step becomes `{"text": step}`; anything
  else is left for validation to reject. Ingredients and notes need nothing (defaults).
  This covers `recipe.json` and every `versions/NNNN.json` snapshot, since both go through
  `parse_recipe`, so restoring a pre-groups version works.
- Files are rewritten as format 3 only when they are saved (an edit, a mark, a restore),
  as today. The four seed recipes under `src/app/seed/recipes/` are converted to format 3
  by hand (steps as objects), with no groups or notes added.
- `SUMMARY_FIELDS` does not include notes (lists don't show them).

## Drafts (what the editor and Claude send)

In `src/app/recipes/drafts.py`:

- `DraftIngredient` accepts `group`.
- `RecipeDraft.steps` accepts, per item, a string **or** `{text, group}`. A string is a
  step with no group. This keeps the API and MCP backwards compatible and lets Claude send
  plain strings for an ungrouped recipe.
- `RecipeDraft.notes: str = ""`, optional so an older client or a draft without it still
  works.
- Clean-up in `to_recipe`: a group name has its whitespace collapsed (`"  Sauce  x "` →
  `"Sauce x"`); a step is stripped and dropped when blank (its group with it); notes have
  `\r\n` normalised to `\n`, trailing spaces on each line removed and the whole stripped.
  Blank lines inside notes are kept.
- Refusals, as one sentence like the rest: `A group name can be at most 60 characters`,
  `The notes can be at most 5000 characters`.

## Claude (MCP) and the style guide

- `NewRecipe` and `RecipeChanges` take steps as strings or `{text, group}`, ingredients
  with `group`, and `notes` (in `RecipeChanges`, `""` clears them; leaving it out keeps
  them). Lists still replace the whole list, groups included.
- `read_recipe` returns the new fields as they are stored; its docstring says what
  `group` and `notes` are.
- `src/app/style_guide.md` gains:
  - **Groups**: only when a recipe has distinct parts; most have none. Short sentence-case
    names without "For the" ("Marinade", "Sauce", "The day before"). Ingredient groups
    and step groups are separate: steps may be grouped by when rather than what. Keep a
    group's rows together; rows without a group come first. An ingredient used in two
    parts gets a row in each.
  - **Notes**: what isn't a step (storage, make-ahead, swaps, serving). Line breaks are
    kept; `**bold**`, `*italic*` and "- " bullet lines are the only formatting. Empty
    when there's nothing to say.

## History (the readable diff)

`src/app/recipes/diff.py` and `Change.section` in `timeline.py`:

- New section `notes`: `notes added`, `notes removed`, `notes changed` (no text preview).
- An ingredient matched across versions whose group changed: `chicken thighs moved to
  “Marinade”`, `… moved out of “Marinade”`, `… moved from “A” to “B”`.
- Steps are matched by text, so a step that only changed group is a move (`step 3 moved
  to “An hour before”`), not an edit. Text changes report as today, with the step's text.
- A renamed group is one line, `group “Sauce” → “Garlic sauce”`, instead of a move per
  row. A group counts as renamed when it no longer exists and all its matched rows now
  sit in one group that didn't exist before. Done separately for ingredients and steps.
- `web/src/timeline.ts` adds `notes` to its section order (after `method`), so an entry
  reads "Edited method and notes".

## The recipe page

`web/src/RecipeView.tsx`, `web/src/Ingredients.tsx`, `web/src/styles/recipe.css`.
Matches the mockup's Main artboard.

- **Ingredients card.** When no row has a group, the list is unchanged. Otherwise the
  rows are shown in consecutive runs by group; a run with a group gets a heading above
  it (an `h3`: small uppercase label in the accent ink, with a thin rule under it, as in
  the mockup). The ungrouped run at the top has no heading; an ungrouped run further down
  gets the rule alone. Each run is its own `ul`.
  Scaling, the unit toggle, the drinks bar summary, per-row bar buttons, undo and bar
  errors behave as now; rows keep their index in the recipe's ingredient list, which the
  bar state code relies on.
- **Method.** Same runs and headings; one `ol` per run, numbered continuously through the
  method (`ol start`, or the existing number badge carrying the overall count).
- **Notes.** A section after Method and before Source, headed "Notes", shown only when
  `notes` is not empty, rendered as in "Notes formatting" below. It is a tinted card
  (`--accent-soft` mixed into `--surface`, `--card-rule` border) with a pencil icon in an
  `--accent` circle before the heading, so it reads as an aside; the drinks side gets the
  same card in its green tokens.

### Notes formatting

Notes are stored as the text typed; formatting is applied only when shown. The rules,
line by line:

- **Bullets.** A line starting with `- ` (also `* ` or `• `, after optional spaces) is a
  bullet; the marker is dropped. Consecutive bullet lines form one `ul`. No nesting:
  indented bullets are the same level.
- **Paragraphs.** Other lines are text. Consecutive text lines form one paragraph with
  their line breaks kept; a blank line separates paragraphs. A blank line between bullets
  ends one list and starts another.
- **Inline, within one line:** `**text**` is bold (`<strong>`), `*text*` is italic
  (`<em>`), and `***text***` is both. Bold is matched first, then italics. A marker
  only counts when the text inside is not empty and doesn't start or end with a space,
  so `2 * 3 * 4` and a lone `*` stay as written. An unmatched marker shows as written.
- Built from React elements and text nodes only: never `dangerouslySetInnerHTML`, and no
  Markdown library. A pure function (text → blocks of inline runs) carries the rules, so
  they're tested without rendering.

## The editor

`web/src/Editor.tsx`, `web/src/editor.ts`, `web/src/styles/editor.css`. There was no
mockup for the editor; this is Claude's call, built from the editor's existing pieces.

- **Group headings are rows in the list.** The ingredient list and the step list can each
  hold heading rows next to ingredient rows / steps. A heading row is a text box ("Group
  name") with the same move up / move down / remove buttons. Every row below a heading,
  up to the next heading, is in that group; rows above the first heading have none.
  This keeps one ordered list, works with the existing move buttons on a phone, and
  makes "keep a group's rows together" automatic.
- **Adding.** Next to "Add ingredient" and "Add step", an "Add group" button appends a
  heading row and one blank row under it, and focuses the heading's text box.
- **Removing a heading** merges its rows into the group above (or into none).
- **A blank heading** means "no group" for the rows under it; its text box shows the
  placeholder "Group name (none)". A person can make one deliberately to end a group
  partway down. On load, the editor puts a heading before each change of group, and a
  blank one where rows go back to no group after a group.
- **Numbering in the form** (labels such as "Ingredient 3", "Step 2", error messages)
  counts ingredient rows and steps only, never headings.
- **Notes.** A "Notes" card after Steps (desktop: in the main column; phone: after Steps):
  a textarea several lines tall, and a small toolbar above it:
  - **Bold** and **Italic** wrap the selected text in `**` / `*` (with nothing selected,
    they insert the pair with the caret in the middle).
  - **List** puts `- ` at the start of every selected line, or takes it off when all of
    them already have it.
  - Each keeps the selection on the same text and focus in the textarea; the change is
    one ordinary edit of the text.
  - A one-line hint under it: "New lines are kept. \*\*bold\*\*, \*italic\*, and - at
    the start of a line for a bullet."
- `isDirty`, `stateFromRecipe`, `toDraft` and `validate` cover the new state. The editor
  sends steps as `{text, group}` objects and always sends `notes`.

## Elsewhere

- `bar.py`, `have.py`, `ingredients.py`, `search.py`, `catalog.py` read ingredient rows
  and ignore `group`; they need no change beyond any code that rebuilds an `Ingredient`
  (it must keep `group`). Check each place that constructs or copies ingredient rows or
  steps.
- `web/src/types.ts` mirrors the model: `Ingredient.group`, `Step`, `Recipe.notes`, and
  the draft types.
- No change to `home-server`, `nas-app.toml` or `config.toml`.

## Deploying and rollback

Merging to `main` deploys. Recipes on the NAS are format 2 and are migrated as they are
read; each is written as format 3 the next time it is saved. **Rollback caveat:** an image
from before this change refuses format 3 files as "newer". After a rollback, recipes saved
since the deploy would be skipped until rolling forward again, and History entries for
edits that changed notes are hidden (the old image doesn't know the `notes` section and
skips those lines; they stay in the file and come back on rolling forward). Accepted
(Claude's call); the PR must say both.

## Testing

- Python: model migration (string steps, already-object steps, a bad shape), a v2
  snapshot restore, draft clean-up and refusals, MCP add/edit with groups and notes
  (strings and objects), diff lines (move, rename, notes), seed files load as format 3.
  Existing tests that build `Recipe(...)` or compare `steps` with strings are updated.
- Web: grouped and ungrouped ingredient lists (food and drinks), continuous numbering
  across method groups, notes formatting (bold, italic, both, unmatched and spaced
  markers, bullets and paragraphs, line breaks, no HTML injection), editor headings (add, move, remove, blank, load and save round trip), the
  Bold, Italic and List buttons, `timeline.ts` section wording.
- `just lint` and `just test` pass. Before the PR, a phone and desktop screenshot of a
  grouped recipe and the editor, added to `docs/design/screenshots/` like earlier
  milestones.

## Left to the builder

- Exact CSS for headings and the Notes card, within the mockup's look and the drinks
  theme's tokens.
- How the runs are computed (a shared helper for ingredients and steps is expected).
- Test file layout, and whether `docs/plan.md` gets a line for this.
