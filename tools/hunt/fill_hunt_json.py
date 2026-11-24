"""Copies real clip durations (hunt/durations.json from build_hunt.py) into the repo's data/hunt.json.
1410 plays all eight storm fragments in rotation (loop), not one fragment per hour."""
import json, os

DA = os.path.join(os.path.expanduser("~"), ".deadair")
REPO_HUNT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "hunt.json")

durs = json.load(open(os.path.join(DA, "hunt", "durations.json")))
hunt = json.load(open(REPO_HUNT, encoding="utf-8"))
for st in hunt["stations"]:
    if st["freq"] == 1410:
        st["mode"] = "loop"
    for c in st["clips"]:
        if c["id"] in durs:
            c["seconds"] = durs[c["id"]]
lm = hunt["last_minute"]["clip"]
if lm["id"] in durs:
    lm["seconds"] = durs[lm["id"]]
missing = [c["id"] for st in hunt["stations"] for c in st["clips"] if c["id"] not in durs]
json.dump(hunt, open(REPO_HUNT, "w", encoding="utf-8"), indent=2)
print("filled; still placeholder:", missing or "none")
