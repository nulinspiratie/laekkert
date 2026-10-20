# Lækkert style guide

How Claude writes recipes for Lækkert, Serwan's recipe app. Read this before adding or
editing a recipe, and follow it.

## The two sides

Food and drinks are separate sides and are never mixed. Every recipe belongs to one.

| Side | Categories |
| --- | --- |
| food | mains, sides, desserts, sauces, prep |
| drinks | cocktails, mocktails, syrups, prep |

Use `prep` for things made ahead and used in other recipes: stock, pickled onions, a spice
mix, a cordial base.

## Names

- Short and plain, in sentence case: "Red lentil dal", "Chicken and leek traybake",
  "Virgin mojito".
- No adjectives the recipe doesn't need ("the best", "easy", "amazing"), and no author
  or site name.
- Keep a dish's own name when it has one ("Daiquiri", "Shakshuka").

## Servings and time

- Servings: what the recipe makes. A drink is usually 1.
- `time_minutes`: the whole time from start to table or glass, waiting included, as a
  whole number. Leave it out when the source doesn't say and you can't judge it.

## Ingredients

One row per ingredient, in the order they're used.

- **Metric only.** Solids and spices in `g`, liquids in `ml`. Never cups, ounces,
  pounds or sticks.
- **Units:** `g`, `ml`, `piece` (eggs, onions, limes, garlic cloves), `dash` (bitters),
  `pinch` and `to taste` (no amount). For small spoon amounts you may pass `tsp` or
  `tbsp` with the amount: the app turns them into grams when it knows the ingredient's
  weight, and into millilitres otherwise.
- **Converting:** 1 cup = 240 ml; 1 fl oz = 30 ml (so ¾ oz = 22.5 ml); 1 oz = 28 g;
  1 lb = 454 g; 1 stick of butter = 113 g. For cups of a dry ingredient use its weight:
  flour 125 g, sugar 200 g, brown sugar 220 g, rice 185 g, grated cheese 100 g. Round to
  amounts a cook would weigh: to the gram under 20 g, to 5 g up to 200 g, to 10 g above
  that. Round ml the same way, except drinks, which keep their exact bar measures.
- **When you can't convert** an amount ("a handful", "1 tin"), give the unit you'd
  expect (`g`, `ml` or `piece`), leave out the amount, and put the source's wording in
  `original`. The app shows it as written and flags it.
- **item:** the ingredient's plain name, lowercase, without amounts or preparation:
  "red onion", "lime juice", "white rum", "garlic cloves". Use the same name as other
  recipes in the app when it's the same thing.
- **note:** preparation and choices: "finely chopped", "fresh", "bone-in, skin on",
  "1:1".
- **no_scale:** true for things that don't grow with the servings: a pinch, salt to
  taste, one lemon for the whole tray, oil for frying.

## Method

- One step per action or stage, as full sentences in the imperative: "Heat the oven to
  200 °C."
- No numbering: the app numbers the steps.
- Temperatures in °C. Give the fan setting when it matters: "200 °C (180 °C fan)".
- Times in the step that needs them ("Simmer for 20 minutes, until thick").
- Leave out the story, tips about the author's life, and anything that isn't cooking.

## Tags

- Lowercase, few, and useful as filters: `vegetarian`, `vegan`, `batch cook`,
  `date night`, `quick`, `kid approved`, `classic`, `mocktail`.
- Use a tag already in use when one fits; look at existing recipes with
  `search_recipes` or `list_recipes` first.
- Never set marks (favourite, try next, tried) or ratings. Those are for the people who
  cook.

## Sources and photos

- **From a web page:** fetch the page yourself, write the recipe from it in this style,
  and pass the page's address as `source_url`. The app saves the link and takes the
  page's main photo by itself.
- **Photo rule:** the app is private (just Serwan and his partner, behind a login), so
  any photo is fine. For a recipe from a web page, the app uses the page's own photo; pass
  an `image_url` only if you found a better one. For a recipe with no source (an idea, or
  one you wrote), look for a photo on the web that shows the dish well and pass its
  direct image address as `image_url`. No photo is fine too: recipes without one look
  intentional.
- **From a photo in the chat** (a cookbook page, a handwritten card): read it and write
  the recipe from it. You can't attach that photo to the recipe; Serwan adds it in the
  app if he wants it.

## Editing

- Read the recipe first, and pass the `version` you read to `edit_recipe`. If it has
  changed in the meantime, read it again and redo the change.
- Change only what was asked. Fields you leave out stay as they are.
- Every edit is kept in the recipe's history and can be undone in the app, so say in a
  sentence what you changed.
