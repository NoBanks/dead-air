"""Dead John voice studio. Renders N takes of every line in Ryan's cloned voice, then QA's each take.

  studio.py <lines.json> <session_dir> [takes=4] [--only=id1,id2]

Runs headless under pythonw (no console window). All output goes to <session_dir>/studio.log.
Writes <session_dir>/<id>_take<k>.wav plus manifest.json (merged across runs, so a regen adds
takes 5-8 next to 1-4). Local only: Qwen3-TTS voice clone + Whisper QA on the laptop GPU, $0.
"""
import gc, json, os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
REF_WAV = os.environ.get("VOICE_REF_WAV", os.path.join(os.path.expanduser("~"), ".deadair", "voice", "ref", "ryan_ref_24k_12s.wav"))  # the creator's voice sample, never in the repo
REF_TXT = os.environ.get("VOICE_REF_TXT", os.path.join(os.path.expanduser("~"), ".deadair", "voice", "ref", "ryan_ref_24k_12s.txt"))
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
NO_WINDOW = 0x08000000
SR = 24000

# Say it the way Dead John says it.
LEXICON = [
    (r"\bDEAD AIR\b", "Dead Air"),
    (r"\bNoBanks Nearby\b", "No Banks Nearby"),
    (r"\bNoBanks\b", "No Banks"),
    (r"\b1714\b", "seventeen fourteen"),
    (r"\bAM\b", "A M"),
    (r"\bLIVE\b", "Live"),
    (r"\bACiD\b", "acid"),
]

def say(text):
    for pat, repl in LEXICON:
        text = re.sub(pat, repl, text)
    return text.strip()

def sentences(text, target=220, hard=280):
    """Split long text at sentence ends; one huge generate() call can silently truncate."""
    out, cur = [], ""
    for s in re.split(r"(?<=[.!?])\s+", text):
        if cur and (len(cur) + len(s) + 1 > hard or len(cur) >= target):
            out.append(cur)
            cur = s
        else:
            cur = f"{cur} {s}".strip()
    return out + [cur] if cur else out

def loudnorm(np, wav):
    p = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1",
                        "-i", "pipe:0", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", str(SR), "-ac", "1",
                        "-f", "f32le", "pipe:1"],
                       input=wav.astype(np.float32).tobytes(), capture_output=True, timeout=120, creationflags=NO_WINDOW)
    return np.frombuffer(p.stdout, dtype=np.float32) if p.returncode == 0 and p.stdout else wav

def edges(np, wav, thresh_db=-40):
    loud = np.flatnonzero(np.abs(wav) > 10 ** (thresh_db / 20))
    return (0.0, 0.0) if not len(loud) else (loud[0] / SR, (len(wav) - 1 - loud[-1]) / SR)

SMALL = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split()

def words(s):
    out = []
    for w in re.findall(r"[a-z0-9']+", s.lower()):
        for part in re.findall(r"\d+|[a-z']+", w):
            out.append(SMALL[int(part)] if part.isdigit() and int(part) <= 20 else part)
    return out

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    only = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--only=")), "")
    lines = json.load(open(args[0], encoding="utf-8"))
    if only:
        lines = [l for l in lines if l["id"] in only.split(",")]
    session = os.path.abspath(args[1])
    n = int(args[2]) if len(args) > 2 else 4
    os.makedirs(session, exist_ok=True)
    sys.stdout = sys.stderr = open(os.path.join(session, "studio.log"), "a", encoding="utf-8", buffering=1)
    wait_pid = next((int(a.split("=", 1)[1]) for a in sys.argv if a.startswith("--wait-pid=")), 0)
    if wait_pid:
        # Queue behind an earlier render so two models never fight over the 4 GB GPU.
        import ctypes
        k32 = ctypes.windll.kernel32
        h = k32.OpenProcess(0x00100000, False, wait_pid)  # SYNCHRONIZE
        if h:
            print(f"WAITING for pid {wait_pid}")
            k32.WaitForSingleObject(h, 0xFFFFFFFF)
            k32.CloseHandle(h)
    print(f"START {time.strftime('%Y-%m-%d %H:%M:%S')} pid {os.getpid()} | {len(lines)} lines x {n} takes")

    import numpy as np
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    man_path = os.path.join(session, "manifest.json")
    manifest = json.load(open(man_path, encoding="utf-8")) if os.path.exists(man_path) else {"lines": {}}
    def save():
        json.dump(manifest, open(man_path, "w", encoding="utf-8"), indent=1)

    tts = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-0.6B-Base", device_map="cuda:0", dtype=torch.bfloat16)
    prompt = tts.create_voice_clone_prompt(ref_audio=REF_WAV, ref_text=open(REF_TXT, encoding="utf-8").read().strip())
    pad = np.zeros(int(SR * 0.35), dtype=np.float32)
    breath = np.zeros(int(SR * 0.4), dtype=np.float32)

    made = []
    for line in lines:
        entry = manifest["lines"].setdefault(line["id"], {"text": line["text"], "takes": []})
        entry["text"] = line["text"]
        parts = sentences(say(line["text"]))
        first = len(entry["takes"]) + 1
        for k in range(first, first + n):
            t0 = time.time()
            torch.manual_seed(1714 * k + len(line["text"]))
            pieces = []
            for i, part in enumerate(parts):
                wavs, _ = tts.generate_voice_clone(text=part, language="English", voice_clone_prompt=prompt)
                pieces.append(np.asarray(wavs[0], dtype=np.float32))
                if i < len(parts) - 1:
                    pieces.append(breath)
            wav = loudnorm(np, np.concatenate([pad, *pieces, pad]))
            name = f"{line['id']}_take{k}.wav"
            sf.write(os.path.join(session, name), wav, SR, subtype="PCM_16")
            take = {"file": name, "take": k, "secs": round(len(wav) / SR, 2), "gen_secs": round(time.time() - t0, 1)}
            entry["takes"].append(take)
            made.append((line, take))
            print(f"TAKE {line['id']} {k} | {take['secs']}s | gen {take['gen_secs']}s")
        save()

    # QA: free the TTS model so Whisper fits on the 4 GB card.
    del tts, prompt
    gc.collect()
    torch.cuda.empty_cache()
    from transformers import pipeline
    asr = pipeline("automatic-speech-recognition", model="openai/whisper-small.en", torch_dtype=torch.float16, device="cuda:0")
    for line, take in made:
        path = os.path.join(session, take["file"])
        wav, _ = sf.read(path, dtype="float32")
        head, tail = edges(np, wav)
        heard = asr(path)["text"].strip()
        want, got = words(say(line["text"])), words(heard)
        match = len(set(want) & set(got)) / max(1, len(set(want)))
        problems = []
        if head < 0.15: problems.append("start may be clipped")
        if tail < 0.15: problems.append("end may be clipped")
        if not (want and got and want[-1] == got[-1]): problems.append(f'last word heard as "{got[-1] if got else ""}"')
        if match < 0.8: problems.append("words differ from script")
        take["qa"] = {"ok": not problems, "problems": problems, "heard": heard, "word_match": round(match, 2)}
        print(f"QA {take['file']} | {'OK' if not problems else '; '.join(problems)} | {heard}")
    save()
    print(f"DONE {time.strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == "__main__":
    main()
