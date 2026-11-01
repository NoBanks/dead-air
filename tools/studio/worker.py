"""Request line studio worker (request-line spec W-1 to W-4).

  pythonw worker.py [--once]

Polls the request queue (~/.deadair/requests/requests.json), renders Dead John reading each
queued request with the local voice clone (studio.py, Qwen3-TTS + Whisper QA), and books it on
the air at least 5 minutes ahead, 10 minutes clear of any other request. Runs headless; log in
~/.deadair/requests/worker.log. Stops by itself at STOP_AT (no forever jobs on this laptop).
"""
import json, os, subprocess, sys, time
from datetime import datetime

HOME = os.path.expanduser("~")
REQ_DIR = os.environ.get("REQUESTS_DIR", os.path.join(HOME, ".deadair", "requests"))
STORE = os.path.join(REQ_DIR, "requests.json")
STUDIO = os.environ.get("STUDIO", os.path.join(HOME, ".deadair", "voice", "studio.py"))
VOICE_PY = os.environ.get("VOICE_PY", os.path.join(HOME, ".nightride", "voice-env", "Scripts", "pythonw.exe"))
FF = os.environ.get("FFMPEG", r"C:\Users\machi\Downloads\ffmpeg-8.0.1-essentials_build_CLEAN\bin\ffmpeg.exe")
STOP_AT = datetime(2026, 11, 4, 23, 59)

MIN_LEAD_MS = 5 * 60_000      # REQ-21: at least 5 minutes after render
MIN_GAP_MS = 10 * 60_000      # REQ-23: requests at least 10 minutes apart
MAX_READ_S = 30.0             # REQ: a read always fits a break
MIN_WORD_MATCH = 0.85         # REQ-17: Whisper check

def build_script(rec):
    """W-2: what Dead John says. Fields were validated by the server (letters, short, no links)."""
    parts = [f"Got a call on the request line. This one's from {rec['from']}, for {rec['to']}."]
    if rec.get("message"):
        parts.append(rec["message"].strip())
    if rec.get("songTitle"):
        parts.append(f"Here's {rec['songTitle']}.")
    return " ".join(parts)

def choose_take(takes, max_s=MAX_READ_S, min_match=MIN_WORD_MATCH):
    """W-3: best take that passed Whisper and fits the break, else None (the request is dropped)."""
    good = [t for t in takes
            if t.get("qa", {}).get("ok") and t.get("qa", {}).get("word_match", 0) >= min_match and t["secs"] <= max_s]
    return sorted(good, key=lambda t: (-t["qa"]["word_match"], t["take"]))[0] if good else None

def assign_air_at(now_ms, taken):
    """W-4: first time >= now + 5 min that is at least 10 min from every other booked request."""
    t = now_ms + MIN_LEAD_MS
    for other in sorted(taken):
        if abs(t - other) < MIN_GAP_MS:
            t = max(t, other + MIN_GAP_MS)
    while any(abs(t - o) < MIN_GAP_MS for o in taken):
        t += 60_000
    return t

# ---------------------------------------------------------------------------- I/O
def log(*a):
    with open(os.path.join(REQ_DIR, "worker.log"), "a", encoding="utf-8") as f:
        print(datetime.now().strftime("%m-%d %H:%M:%S"), *a, file=f)

def load():
    try:
        return json.load(open(STORE, encoding="utf-8"))
    except Exception:
        return {}

def save_one(rec):
    """Merge one record into the store (the server may have added new calls meanwhile)."""
    all_ = load()
    all_[rec["ticket"]] = rec
    tmp = STORE + ".tmp"
    json.dump(all_, open(tmp, "w", encoding="utf-8"), indent=1)
    os.replace(tmp, STORE)

HIDDEN = subprocess.STARTUPINFO()
HIDDEN.dwFlags |= subprocess.STARTF_USESHOWWINDOW
HIDDEN.wShowWindow = 0

def render(rec):
    sess = os.path.join(REQ_DIR, "render", rec["ticket"])
    os.makedirs(sess, exist_ok=True)
    lines = os.path.join(sess, "lines.json")
    json.dump([{"id": "read", "text": build_script(rec)}], open(lines, "w", encoding="utf-8"))
    subprocess.run([VOICE_PY, STUDIO, lines, sess, "2"], startupinfo=HIDDEN, creationflags=0x08000000,
                   timeout=900)
    man = json.load(open(os.path.join(sess, "manifest.json"), encoding="utf-8"))
    take = choose_take(man["lines"]["read"]["takes"])
    if not take:
        return None
    mp3 = os.path.join(REQ_DIR, rec["ticket"] + ".mp3")
    subprocess.run([FF, "-y", "-v", "error", "-i", os.path.join(sess, take["file"]),
                    "-af", "loudnorm=I=-16:TP=-1.5", "-ar", "44100", "-b:a", "160k", mp3],
                   startupinfo=HIDDEN, creationflags=0x08000000, check=True)
    return take["secs"]

def tick():
    now = int(time.time() * 1000)
    recs = load()
    for rec in recs.values():  # REQ-26: scheduled -> aired once its read has passed
        if rec["status"] == "scheduled" and rec.get("airAt") and now > rec["airAt"] + 20 * 60_000:
            rec["status"] = "aired"
            save_one(rec)
    queued = sorted((r for r in recs.values() if r["status"] == "queued"), key=lambda r: r["createdAt"])
    if not queued:
        return
    rec = queued[0]
    log("render", rec["ticket"])
    try:
        secs = render(rec)
    except Exception as e:
        log("render failed", rec["ticket"], repr(e))
        secs = None
    if secs is None:
        rec["status"] = "dropped"
        save_one(rec)
        log("dropped", rec["ticket"])
        return
    rec["status"] = "rendered"
    save_one(rec)
    taken = [r["airAt"] for r in load().values() if r.get("airAt") and r["status"] in ("scheduled", "aired")]
    rec["airAt"] = assign_air_at(int(time.time() * 1000), taken)
    rec["clipFile"] = f"/requests/{rec['ticket']}.mp3"
    rec["clipSeconds"] = round(secs, 2)
    rec["status"] = "scheduled"
    save_one(rec)
    log("scheduled", rec["ticket"], datetime.fromtimestamp(rec["airAt"] / 1000).strftime("%H:%M"))

def main():
    os.makedirs(REQ_DIR, exist_ok=True)
    log("worker start pid", os.getpid())
    while datetime.now() < STOP_AT:
        try:
            tick()
        except Exception as e:
            log("tick error", repr(e))
        if "--once" in sys.argv:
            break
        time.sleep(20)
    log("worker stop")

if __name__ == "__main__":
    main()
