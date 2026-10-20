# Recipe App — Requirements (V1)

Oct 19, 2026 · @Serwan

A personal food and drinks recipe app for Serwan and his partner, self-hosted, with Claude as a first-class way to add and edit recipes. Builds on the Bar Book idea.

## Core

1. One app, two clearly separate sides: **Food** and **Drinks**. Same layout, own accent colour. Food and drinks are never mixed. The app remembers the last side used.
2. Two users (Serwan and partner). Ratings, marks and tags are shared. Timeline entries record their author.
3. Self-hosted on the Synology DS220+ like the other apps. Installable PWA served over HTTPS via the existing Cloudflare setup on serwan.me, protected by Cloudflare Access.
4. Responsive: phone (cooking, shopping) and desktop (editing, browsing).

## Recipes

5. GUI form editor to add and edit recipes: name, category, servings, ingredient rows (amount, unit, item, note), steps, source, tags, image.
6. Storage: one plain file per recipe (JSON or Markdown with front matter) in a folder on the NAS, covered by regular backups. Layout must be Git-friendly for a later move to GitHub.
7. Units are metric only. Liquids in ml, solids and spices in g. No cups. Claude converts on import.
8. Teaspoon/tablespoon display toggle for small amounts. Each catalog ingredient can store its own g-per-tsp conversion. If a conversion is missing, show the original unit as written (e.g. "1 tsp") and flag it so Claude can fill it in later.
9. Servings scaling with a stepper. Sensible rounding (eggs, butter). Per-ingredient "don't scale" flag for things like "a pinch" or "salt to taste".
10. Source on every recipe where available: URL or an uploaded photo. Recorded automatically on import.
11. Images are optional. Recipes without a photo must look intentional.
12. Recipe format carries a version number so older recipes keep loading after the format changes.
13. Categories. Food: mains, sides, desserts, sauces and prep. Drinks: cocktails, mocktails, syrups and prep.

## Tags and marks

14. Simple free-form tags, added by the user (e.g. vegetarian, mocktail, date night, batch cook). Tags work as filters.
15. Marks: tried, favourite, try next. Favourite implies tried. Try next clears on the first logged tasting. Anything else, such as kid approved, is a regular tag.

## Timeline and history

16. One timeline per recipe holding notes, rating changes and recipe edits. Each entry has date and author.
17. Current rating = latest rating in the timeline.
18. Every recipe edit stores a snapshot. The timeline shows a readable diff (e.g. "lime juice 25 → 20 ml"). Rollback to any earlier version.

## Discovery

19. Ingredient catalog so the same ingredient isn't stored under several names.
20. Drinks inventory: track shelf-stable items (bottles, bitters, syrups) as have / don't have. Fresh items (limes, mint, soda) are marked as fresh and not tracked. Suggestions: "can make now" and "just buy fresh items".
21. Food: throwaway ingredient filter ("I have chicken and leeks") that is never saved, ranking recipes by fewest missing ingredients.
22. Fuzzy search across names and ingredients, tolerant of typos and word order ("chicken curry" finds "curry with chicken").
23. Default food view: all meals, sorted by cooking time.

## Claude integration

24. MCP server exposing: add recipe, edit recipe, search recipes, read recipe, merge ingredients, manage inventory.
25. Import from a URL or an idea. On URL import, save the source link and grab the site's main image automatically. Without a source, search for a fitting photo; fall back to an illustration.
26. A Claude instruction/style guide (like the Bar Book guide) defines how recipes are written, the image licensing rule, and unit conventions.

## Not in V1 (later)

This list as written for V1. The current list of ideas is `docs/ideas.md`.

- Smart tags: rule-based tags (e.g. vegetarian from ingredient flags, mocktail from no alcohol, under 30 minutes). Any manual tag can be turned smart; once smart, the rule takes over completely. Needs a migration path from simple tags.
- Kitchen mode (screen stays awake, large text, step-by-step). High priority follow-up.
- Shopping list.
- Recipes in a private GitHub repo; Claude Code for bulk work (merges, rewriting many recipes against an updated style guide). App pulls before writing.
- "Find image" button using AI search to pick the best photo.
- Built-in AI, e.g. dictate a recipe and have it structured.

## Open questions

- Test whether Claude can upload a photo attached in chat, or only read it. The app's own upload button is the fallback either way.
- Image licensing on import: keep the source site's photo (private app) or only freely licensed photos.
- Tech stack, decided at build time.
- Migration: none formal. Use one or two Bar Book recipes as test data, and add others through the new Claude import flow.
