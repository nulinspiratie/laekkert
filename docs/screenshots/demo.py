"""Fill a fresh local Lækkert with the demo library the README screenshots show.

Usage, from the repo root:

    D=$(mktemp -d); P=.data/demo-photos
    (cd web && npm ci && npm run build)
    APP_CONFIG=config.example.toml APP_DATA_DIR=$D STATIC_DIR=web/dist uv run app &
    uv run python docs/screenshots/demo.py $D $P
    node docs/screenshots/shoot.mjs docs/screenshots

Start from an empty data folder so the bundled examples are seeded. Every recipe
gets a photo from PHOTO_DIR/<slug>.jpg (or .png, .webp). A missing one is made
with an image model on OpenRouter (OPENROUTER_API_KEY) from the prompts below;
delete a photo to redo it. The photos are generated, not real dishes, and are
only used for these screenshots.
"""

# ruff: noqa: E501  (the recipe tables are written one dense line per item)

import base64
import datetime as dt
import json
import os
import random
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://localhost:8080"
IMAGE_MODEL = "google/gemini-3.1-flash-image"
FOOD_STYLE = (
    "Natural, appetising home-cooking food photography, soft daylight from a window, "
    "shallow depth of field, shot slightly from above on a warm rustic wooden table "
    "with a linen napkin. Realistic, not overly styled, no text, no people, no hands."
)
DRINK_STYLE = (
    "Natural cocktail photography at home, warm evening light, shallow depth of field, "
    "on a dark wooden bar top with a soft blurred background. Realistic, not overly "
    "styled, no text, no people, no hands, no logos or labels."
)
PHOTOS = {
    "shakshuka": "shakshuka in a black cast-iron pan: eggs poached in a red tomato "
    "and pepper sauce, sprinkled with chopped parsley, crusty bread on the side",
    "spaghetti-aglio-e-olio": "a plate of spaghetti aglio e olio: glossy spaghetti "
    "with thinly sliced golden garlic, red chilli flakes and chopped parsley",
    "crispy-smashed-potatoes": "crispy smashed baby potatoes on a baking tray, deep "
    "golden and crunchy edges, olive oil, flaky salt and chopped rosemary",
    "miso-glazed-aubergine": "two halves of miso-glazed aubergine (eggplant), scored "
    "flesh with a caramelised glossy miso glaze, sprinkled with sesame seeds, on a "
    "ceramic plate",
    "lemon-olive-oil-cake": "a round lemon olive oil cake with one slice cut out on "
    "a plate, golden crust, a lemon beside it",
    "chimichurri": "a small bowl of fresh green chimichurri sauce with chopped "
    "parsley, oregano, garlic and olive oil, a spoon in it",
    "quick-pickled-red-onions": "a glass jar of bright pink quick-pickled red onion "
    "slices, with a small dish of them beside it",
    "red-lentil-dal": "a bowl of creamy yellow-orange red lentil dal with a swirl of "
    "coconut milk, fresh coriander and a lime wedge, rice on the side",
    "chicken-leek-traybake": "a chicken and leek traybake in a roasting tin: golden "
    "crispy chicken thighs on soft roasted leeks",
    "negroni": "a Negroni cocktail in a rocks glass with one large clear ice cube, "
    "deep red-orange colour",
    "old-fashioned": "an Old Fashioned cocktail in a heavy rocks glass with one large "
    "clear ice cube, amber whiskey colour",
    "margarita": "a Margarita cocktail in a coupe glass with salt on half the rim, "
    "pale green-yellow, a lime wedge beside it",
    "whiskey-sour": "a Whiskey Sour cocktail in a rocks glass over ice with a thick "
    "white foam top dotted with a few drops of Angostura bitters",
    "paloma": "a Paloma cocktail in a tall highball glass with ice, pale pink "
    "grapefruit soda, a grapefruit slice",
    "espresso-martini": "an Espresso Martini in a chilled coupe with a creamy tan "
    "crema on top and three coffee beans",
    "ginger-lime-fizz": "a ginger lime fizz mocktail in a tall glass with ice, ginger "
    "beer, lime wheels and fresh mint leaves",
    "honey-syrup": "a small glass bottle of golden honey syrup next to a jar of honey "
    "with a honey dipper",
    "daiquiri": "a classic Daiquiri cocktail in a chilled coupe, pale cloudy lime "
    "colour, a thin lime wheel on the rim",
    "virgin-mojito": "a Virgin Mojito mocktail in a tall glass with crushed ice, lots "
    "of fresh mint leaves and lime wedges, soda bubbles",
}


def call(method, path, body=None, content_type="application/json"):
    data = body if isinstance(body, bytes) else None
    if body is not None and data is None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path, method=method, data=data, headers={"Content-Type": content_type}
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path}: {e.code} {e.read().decode()}") from e


TYPES = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def make_photo(slug, side):
    style = FOOD_STYLE if side == "food" else DRINK_STYLE
    body = {
        "model": IMAGE_MODEL,
        "modalities": ["image", "text"],
        "messages": [{"role": "user", "content": f"Photo of {PHOTOS[slug]}. {style}"}],
        "image_config": {"aspect_ratio": "4:3"},
    }
    key = os.environ.get("OPENROUTER_API_KEY", "sk-or-proxy")
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        message = json.load(r)["choices"][0]["message"]
    head, data = message["images"][0]["image_url"]["url"].split(",", 1)
    ext = next(e for e, t in TYPES.items() if t in head)
    path = PHOTO_DIR / f"{slug}{ext}"
    path.write_bytes(base64.b64decode(data))
    print("made", path)
    return path


def photo(slug, side):
    """The photo file for a recipe, made first if there is none yet."""
    found = [PHOTO_DIR / f"{slug}{ext}" for ext in TYPES]
    return next((p for p in found if p.exists()), None) or make_photo(slug, side)


def upload(path):
    return call("POST", "/api/uploads", path.read_bytes(), TYPES[path.suffix])["name"]


def ing(amount, unit, item, note="", **kw):
    return {"amount": amount, "unit": unit, "item": item, "note": note, **kw}


def recipe(side, name, category, servings, minutes, ingredients, steps, tags=()):
    return {
        "side": side,
        "name": name,
        "category": category,
        "servings": servings,
        "time_minutes": minutes,
        "ingredients": ingredients,
        "steps": steps,
        "source": None,
        "tags": list(tags),
    }


FOOD = [
    recipe("food", "Shakshuka", "mains", 2, 30, [
        ing(30, "ml", "olive oil"), ing(1, "piece", "onion", "sliced"),
        ing(1, "piece", "red pepper", "sliced"), ing(2, "piece", "garlic", "crushed"),
        ing(2.1, "g", "ground cumin"), ing(2.3, "g", "smoked paprika"),
        ing(400, "g", "chopped tomatoes"), ing(4, "piece", "egg"),
        ing(None, "to taste", "salt"), ing(10, "g", "parsley", "chopped"),
    ], [
        "Soften the onion and pepper in the oil for 10 minutes.",
        "Add the garlic and spices, cook for a minute, then the tomatoes. "
        "Simmer 10 minutes.",
        "Make four wells, crack in the eggs, cover and cook until the whites set.",
        "Scatter over the parsley and serve with bread.",
    ], ["vegetarian", "brunch"]),
    recipe("food", "Spaghetti aglio e olio", "mains", 2, 15, [
        ing(200, "g", "spaghetti"), ing(60, "ml", "olive oil"),
        ing(4, "piece", "garlic", "thinly sliced"),
        ing(1, "pinch", "chilli flakes", no_scale=True),
        ing(15, "g", "parsley", "chopped"), ing(None, "to taste", "salt"),
    ], [
        "Cook the spaghetti in well-salted water.",
        "Warm the oil with the garlic and chilli over low heat until the garlic is "
        "just golden.",
        "Toss the pasta into the pan with a splash of its water and the parsley.",
    ], ["vegetarian", "weeknight"]),
    recipe("food", "Crispy smashed potatoes", "sides", 4, 60, [
        ing(1000, "g", "baby potatoes"), ing(45, "ml", "olive oil"),
        ing(6, "g", "salt"), ing(5, "g", "rosemary", "chopped"),
    ], [
        "Boil the potatoes until tender, about 20 minutes. Drain and steam dry.",
        "Smash each one flat on an oiled tray, drizzle with oil and season.",
        "Roast at 220 °C for 30 minutes, until deep golden.",
    ], ["vegetarian", "batch cook"]),
    recipe("food", "Miso-glazed aubergine", "sides", 2, 35, [
        ing(2, "piece", "aubergine", "halved lengthways"), ing(30, "g", "white miso"),
        ing(15, "ml", "mirin"), ing(10, "g", "sugar"), ing(5, "g", "sesame seeds"),
    ], [
        "Score the cut sides and roast at 200 °C for 25 minutes.",
        "Mix the miso, mirin and sugar, spread over the aubergine and grill for "
        "3 minutes.",
        "Finish with sesame seeds.",
    ], ["vegetarian"]),
    recipe("food", "Lemon olive oil cake", "desserts", 8, 70, [
        ing(200, "g", "sugar"), ing(3, "piece", "egg"),
        ing(1, "piece", "lemon", "zest and juice"),
        ing(120, "ml", "olive oil"), ing(180, "g", "plain flour"),
        ing(8, "g", "baking powder"), ing(1, "pinch", "salt", no_scale=True),
    ], [
        "Whisk the sugar, eggs and zest until pale and thick.",
        "Stream in the oil and lemon juice, then fold in the flour, baking powder "
        "and salt.",
        "Bake in a lined 20 cm tin at 175 °C for 45 minutes.",
    ], ["vegetarian", "date night"]),
    recipe("food", "Chimichurri", "sauces", 4, 10, [
        ing(30, "g", "parsley"), ing(10, "g", "oregano"), ing(2, "piece", "garlic"),
        ing(30, "ml", "red wine vinegar"), ing(90, "ml", "olive oil"),
        ing(1, "pinch", "chilli flakes", no_scale=True), ing(None, "to taste", "salt"),
    ], [
        "Chop the herbs and garlic finely.",
        "Stir in the vinegar, oil and chilli. Season and rest for 10 minutes.",
    ], ["vegetarian"]),
    recipe("food", "Quick pickled red onions", "prep", 6, 40, [
        ing(2, "piece", "red onion", "thinly sliced"), ing(120, "ml", "cider vinegar"),
        ing(120, "ml", "water"), ing(15, "g", "sugar"), ing(6, "g", "salt"),
    ], [
        "Pack the onions into a jar.",
        "Warm the vinegar, water, sugar and salt until dissolved and pour over.",
        "Leave for 30 minutes. Keeps two weeks in the fridge.",
    ], ["batch cook"]),
]  # fmt: skip

DRINKS = [
    recipe("drinks", "Negroni", "cocktails", 1, 3, [
        ing(30, "ml", "gin"), ing(30, "ml", "campari"), ing(30, "ml", "sweet vermouth"),
    ], ["Stir with ice for 20 seconds.", "Strain over a large cube."],
        ["classic", "bitter"]),
    recipe("drinks", "Old fashioned", "cocktails", 1, 4, [
        ing(60, "ml", "bourbon"), ing(7.5, "ml", "simple syrup"),
        ing(2, "dash", "angostura bitters"),
    ], ["Stir everything with ice until well chilled.", "Strain over a large cube."],
        ["classic", "stirred"]),
    recipe("drinks", "Margarita", "cocktails", 1, 5, [
        ing(50, "ml", "tequila"), ing(20, "ml", "triple sec"), ing(25, "ml", "lime juice"),
        ing(None, "pinch", "salt", "for the rim", no_scale=True, original="a pinch"),
    ], ["Salt half the rim of a coupe.", "Shake everything hard with ice and double strain."],
        ["classic"]),
    recipe("drinks", "Whiskey sour", "cocktails", 1, 5, [
        ing(50, "ml", "bourbon"), ing(25, "ml", "lemon juice"), ing(20, "ml", "simple syrup"),
        ing(1, "piece", "egg white"), ing(2, "dash", "angostura bitters"),
    ], ["Dry shake, then shake again with ice.",
        "Strain into a rocks glass over ice and dot the bitters on the foam."],
        ["classic", "date night"]),
    recipe("drinks", "Paloma", "cocktails", 1, 3, [
        ing(50, "ml", "tequila"), ing(15, "ml", "lime juice"),
        ing(120, "ml", "grapefruit soda"), ing(1, "pinch", "salt", no_scale=True),
    ], ["Build in a highball over ice.", "Top with the grapefruit soda and stir once."],
        ["long", "summer"]),
    recipe("drinks", "Espresso martini", "cocktails", 1, 5, [
        ing(50, "ml", "vodka"), ing(25, "ml", "coffee liqueur"), ing(30, "ml", "espresso"),
        ing(10, "ml", "simple syrup"),
    ], ["Shake hard with ice.", "Double strain into a chilled coupe."], ["after dinner"]),
    recipe("drinks", "Ginger lime fizz", "mocktails", 1, 3, [
        ing(25, "ml", "lime juice"), ing(15, "ml", "honey syrup"),
        ing(150, "ml", "ginger beer"), ing(4, "piece", "mint", "leaves"),
    ], ["Lightly press the mint with the lime and syrup.", "Add ice and top with ginger beer."],
        ["long", "summer"]),
    recipe("drinks", "Honey syrup", "syrups", 10, 5, [
        ing(100, "g", "honey"), ing(50, "ml", "water", "hot"),
    ], ["Stir the honey into the hot water until loose.", "Keeps a month in the fridge."]),
]  # fmt: skip


def made(side, slug, rating=None, note=""):
    path = f"/api/recipes/{side}/{slug}/timeline"
    call("POST", path, {"kind": "made", "rating": rating, "note": note})


def note(side, slug, text):
    call("POST", f"/api/recipes/{side}/{slug}/timeline", {"kind": "note", "text": text})


def marks(side, slug, add=(), remove=()):
    path = f"/api/recipes/{side}/{slug}/marks"
    call("POST", path, {"add": list(add), "remove": list(remove)})


def edit(side, slug, change):
    d = call("GET", f"/api/recipes/{side}/{slug}")
    keys = ("name", "category", "servings", "time_minutes", "steps", "source", "tags")
    draft = {k: d[k] for k in (*keys, "image")}
    ing_keys = ("amount", "unit", "item", "note", "no_scale", "original")
    draft["ingredients"] = [{k: i[k] for k in ing_keys} for i in d["ingredients"]]
    change(draft)
    call("PUT", f"/api/recipes/{side}/{slug}", {**draft, "base_version": d["version"]})


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def add_all(data_dir):
    # The bundled examples were seeded as files and have no history yet, so
    # their photos go straight into their folders.
    for path in sorted((data_dir / "recipes").glob("*/*/recipe.json")):
        r = json.loads(path.read_text())
        src = photo(r["slug"], r["side"])
        (path.parent / f"photo{src.suffix}").write_bytes(src.read_bytes())
        r["image"] = f"photo{src.suffix}"
        path.write_text(json.dumps(r, ensure_ascii=False, indent=2) + "\n")
    for r in FOOD + DRINKS:
        r["image"] = upload(photo(slugify(r["name"]), r["side"]))
        call("POST", "/api/recipes", r)


def history():
    made("food", "red-lentil-dal", 4, "Good, a bit flat. Needs acid at the end.")

    def dal(d):
        lime = ing(15, "ml", "lime juice", "to finish", no_scale=False, original="")
        d["ingredients"].insert(8, lime)
        for i in d["ingredients"]:
            if i["item"] == "coconut milk":
                i["amount"] = 300
        d["steps"].append("Stir in the lime juice just before serving.")

    edit("food", "red-lentil-dal", dal)
    made("food", "red-lentil-dal", 5, "Much better with the lime. Keeper.")
    note("food", "red-lentil-dal", "Freezes well in portions; double the batch.")
    marks("food", "red-lentil-dal", add=["favourite"])

    made("food", "shakshuka", 5, "Sunday brunch. Feta on top next time.")
    marks("food", "shakshuka", add=["favourite"])
    made("food", "spaghetti-aglio-e-olio", 4)
    made("food", "crispy-smashed-potatoes", 5)
    made("food", "lemon-olive-oil-cake", 4, "Lovely crumb; 5 minutes less in our oven.")
    marks("food", "miso-glazed-aubergine", add=["try_next"])
    marks("food", "chimichurri", add=["try_next"])
    made("food", "chicken-leek-traybake", 3)

    made("drinks", "daiquiri", 5)

    def daiquiri(d):
        for i in d["ingredients"]:
            if i["item"] == "lime juice":
                i["amount"] = 22.5

    edit("drinks", "daiquiri", daiquiri)
    made("drinks", "negroni", 5, "Equal parts, big cube. Perfect.")
    marks("drinks", "negroni", add=["favourite"])
    made("drinks", "old-fashioned", 4)
    made("drinks", "margarita", 4)
    made("drinks", "whiskey-sour", 5, "Aquafaba works as well as egg white.")
    made("drinks", "virgin-mojito", 4)
    marks("drinks", "espresso-martini", add=["try_next"])
    marks("drinks", "paloma", add=["try_next"])

    call("POST", "/api/bar", {
        "have": ["gin", "campari", "sweet vermouth", "bourbon", "angostura bitters",
                 "white rum", "tequila"],
        "dont_have": ["vodka", "coffee liqueur", "triple sec"],
        "kinds": {"gin": "spirits", "bourbon": "spirits", "tequila": "spirits",
                  "vodka": "spirits", "campari": "aperitifs", "sweet vermouth": "aperitifs",
                  "triple sec": "liqueurs", "coffee liqueur": "liqueurs",
                  "angostura bitters": "bitters"},
        "untrack": ["lemon juice", "egg white", "grapefruit soda", "ginger beer",
                    "espresso", "simple syrup", "honey", "salt", "water"],
    })  # fmt: skip


def backdate(data_dir):
    """Spread each timeline over the past weeks; some recipes came in via Claude."""
    rng = random.Random(7)
    end = dt.datetime(2026, 10, 18, 19, 30)
    claude = {"shakshuka", "miso-glazed-aubergine", "whiskey-sour", "paloma",
              "espresso-martini", "lemon-olive-oil-cake", "red-lentil-dal"}  # fmt: skip
    for tl in sorted((data_dir / "recipes").glob("*/*/timeline.jsonl")):
        lines = [json.loads(line) for line in tl.read_text().splitlines() if line]
        t = end - dt.timedelta(days=rng.randint(0, 3))
        times = []
        for _ in lines:
            times.append(t)
            t -= dt.timedelta(
                days=rng.randint(4, 14),
                hours=rng.randint(-3, 3),
                minutes=rng.randint(0, 59),
            )
        for e, at in zip(lines, reversed(times), strict=True):
            e["at"] = at.strftime("%Y-%m-%dT%H:%M:%SZ")
        slug = tl.parent.name
        if slug in claude and lines and lines[0]["kind"] in ("created", "baseline"):
            lines[0]["via"] = "claude"
        if slug == "red-lentil-dal":
            for e in lines:
                if e["kind"] == "edit":
                    e["via"] = "claude"
        tl.write_text(
            "".join(
                json.dumps(e, ensure_ascii=False, separators=(",", ":")) + "\n"
                for e in lines
            )
        )


if __name__ == "__main__":
    data_dir, PHOTO_DIR = Path(sys.argv[1]), Path(sys.argv[2])
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    add_all(data_dir)
    history()
    backdate(data_dir)
    print("demo library ready")
