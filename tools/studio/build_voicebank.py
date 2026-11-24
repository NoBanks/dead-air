"""Turn Ryan's picks into the station's voice bank.

  build_voicebank.py   (writes ~/.deadair/voice_mp3/<id>.mp3, repo data/voicebank.json + data/featured.json)

Only picked takes go on air. A redo session (sessions/<name>_redo) overrides its parent's pick
for the lines it re-rendered. Hidden-station lines are left out: they are spoiler content served
by the hunt later, never in the public voice bank.
"""
import json, os, re, subprocess

VOICE = os.path.dirname(os.path.abspath(__file__))
SESS = os.path.join(VOICE, "sessions")
OUT = os.path.join(os.path.dirname(VOICE), "voice_mp3")
REPO_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data")
FF = os.environ.get("FFMPEG", "ffmpeg")
STAGE = os.path.join(os.path.dirname(VOICE), "data")  # copied into the repo after Kiro's stubs are replaced
PUBLIC = ["recurring_v1", "recurring_v2", "setups_v1"]
HIDDEN = subprocess.STARTUPINFO()
HIDDEN.dwFlags |= subprocess.STARTF_USESHOWWINDOW
HIDDEN.wShowWindow = 0

KINDS = [  # first match wins
    (r"^signon", "signon"), (r"^signoff", "signoff"), (r"^(id|tophour)_", "id"), (r"^drop_", "drop"),
    (r"^(talkup|frontsell)_", "talkup"), (r"^backsell", "backsell"), (r"^feat_", "setup"),
    (r"^marty", "marty"), (r"^(storm|ebs_after)", "storm"), (r"^sponsor", "sponsor"), (r"^caller", "caller"),
    (r"^(signal|numbers_tease)", "signal"), (r"^request", "request"), (r"^midnight", "midnight"),
]

def kind_of(lid):
    for pat, k in KINDS:
        if re.match(pat, lid):
            return k
    return "break"  # checkin, time, coffee, weather, capsule, town, listener, philosophy

def air_of(lid, text):
    """When a line may air: "0314" only at 3:14 AM, "night" only 7 PM to 6 AM, None anytime."""
    if lid == "time_314":
        return "0314"
    if re.search(r"\b(tonight|tonight's|overnight|good evening)\b", text, re.I):
        return "night"
    return None

def load(path, default):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:
        return default

def main():
    os.makedirs(OUT, exist_ok=True)
    clips, featured = [], []
    for name in PUBLIC:
        lines = load(os.path.join(SESS, name, "manifest.json"), {"lines": {}})["lines"]
        picks = load(os.path.join(SESS, name, "picks.json"), {})
        redo_dir = os.path.join(SESS, name + "_redo")
        redo_lines = load(os.path.join(redo_dir, "manifest.json"), {"lines": {}})["lines"]
        redo_picks = load(os.path.join(redo_dir, "picks.json"), {})
        for lid, line in lines.items():
            src_dir, take = os.path.join(SESS, name), picks.get(lid)
            if lid in redo_lines:  # a redo was asked: only the redo pick counts
                src_dir, take, line = redo_dir, redo_picks.get(lid), redo_lines[lid]
            if not take:
                continue
            t = next((t for t in line["takes"] if str(t["take"]) == str(take)), None)
            if not t:
                continue
            mp3 = os.path.join(OUT, lid + ".mp3")
            wav = os.path.join(src_dir, t["file"])
            if not os.path.exists(mp3) or os.path.getmtime(mp3) < os.path.getmtime(wav):
                subprocess.run([FF, "-y", "-v", "error", "-i", wav, "-ar", "44100", "-b:a", "160k", mp3],
                               startupinfo=HIDDEN, creationflags=0x08000000, check=True)
            k = kind_of(lid)
            clip = {"id": lid, "kind": k, "text": line["text"], "seconds": t["secs"], "file": f"/voice/{lid}.mp3"}
            air = air_of(lid, line["text"])
            if air:
                clip["air"] = air
            if k == "setup":
                clip["song_title"] = line.get("title") or ""
                featured.append({"setup_clip_id": lid, "title": clip["song_title"]})
            clips.append(clip)
    # The six town sponsor ads air on 1714 (the Hunt's "Town" page collects them). Not spoilers.
    # Ryan's pick when he has made one, else the best QA take, so the page is collectable now.
    hid = os.path.join(SESS, "hidden_v1")
    hlines = load(os.path.join(hid, "manifest.json"), {"lines": {}})["lines"]
    hpicks = load(os.path.join(hid, "picks.json"), {})
    for lid, line in hlines.items():
        if not lid.startswith("ad_"):
            continue
        takes = line["takes"]
        t = next((t for t in takes if str(t["take"]) == str(hpicks.get(lid))), None)
        if not t:
            ok = [t for t in takes if t.get("qa", {}).get("ok")] or takes
            t = sorted(ok, key=lambda t: (-t.get("qa", {}).get("word_match", 0), t["take"]))[0]
        mp3 = os.path.join(OUT, lid + ".mp3")
        wav = os.path.join(hid, t["file"])
        subprocess.run([FF, "-y", "-v", "error", "-i", wav, "-ar", "44100", "-b:a", "160k", mp3],
                       startupinfo=HIDDEN, creationflags=0x08000000, check=True)
        clips.append({"id": lid, "kind": "sponsor", "text": line["text"], "seconds": t["secs"], "file": f"/voice/{lid}.mp3"})
    lib = {e["title"]: e["id"] for e in load(os.path.join(REPO_DATA, "library.json"), [])}
    titles = {c["id"]: c.get("title") for c in load(os.path.join(VOICE, "lines", "setups_v1.json"), [])}
    for f in featured:
        f["title"] = f["title"] or titles.get(f["setup_clip_id"], "")
        f["song_id"] = lib.get(f["title"])
    for c in clips:
        if c["kind"] == "setup":
            c["song_title"] = c["song_title"] or titles.get(c["id"], "")
            c["song_id"] = lib.get(c["song_title"])
    featured = [f for f in featured if f["song_id"]]
    os.makedirs(STAGE, exist_ok=True)
    json.dump({"clips": clips}, open(os.path.join(STAGE, "voicebank.json"), "w", encoding="utf-8"), indent=1)
    json.dump(featured, open(os.path.join(STAGE, "featured.json"), "w", encoding="utf-8"), indent=1)
    counts = {}
    for c in clips:
        counts[c["kind"]] = counts.get(c["kind"], 0) + 1
    print("clips", len(clips), counts, "featured", len(featured))

if __name__ == "__main__":
    main()
