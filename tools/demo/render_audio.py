"""Render exactly what 1714 AM aired over a time window, offline, for the demo edit.

  python render_audio.py <start_ms> <seconds> <out.wav> [--clean]

Walks the live schedule with GET /now?t= (station on :8787), then mixes the real files: songs
from their offsets, Dead John's breaks, talk-ups with the music ducked 10 dB under them, the
numbers station and the EBS. By default it adds the same AM color as the tuner (120 Hz to 5 kHz
plus soft saturation); --clean leaves it full range. 48 kHz stereo WAV, broadcast loudness.
"""
import json, os, subprocess, sys, urllib.request

HOME = os.path.expanduser("~")
LIB = os.path.join(HOME, ".deadair", "library_mp3")
VOICE = os.path.join(HOME, ".deadair", "voice_mp3")
REQ = os.path.join(HOME, ".deadair", "requests")
FF = r"C:\Users\machi\Downloads\ffmpeg-8.0.1-essentials_build_CLEAN\bin\ffmpeg.exe"
FP = FF.replace("ffmpeg.exe", "ffprobe.exe")
API = "http://127.0.0.1:8787"
SI = subprocess.STARTUPINFO(); SI.dwFlags |= subprocess.STARTF_USESHOWWINDOW; SI.wShowWindow = 0
DUCK = 0.316  # -10 dB


def local(url):
    name = url.rsplit("/", 1)[-1]
    if url.startswith("/audio/"):
        return os.path.join(LIB, name)
    if url.startswith("/requests/"):
        return os.path.join(REQ, name)
    return os.path.join(VOICE, name)


def seconds(path):
    r = subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True, startupinfo=SI, creationflags=0x08000000)
    return float(r.stdout.strip())


def segments(start, end):
    out, t = [], start
    while t < end:
        seg = json.load(urllib.request.urlopen(f"{API}/now?t={t}"))["segment"]
        out.append(seg)
        t = seg["endMs"] + 1
    return out


def main():
    start, dur, out = int(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
    end = start + int(dur * 1000)
    inputs, music, voice, ducks = [], [], [], []

    def add(path, at_ms, skip_s, length_s, bus):
        at = max(0, at_ms - start)
        inputs.extend(["-ss", f"{skip_s:.3f}", "-t", f"{length_s:.3f}", "-i", path])
        k = len(inputs) // 6 - 1
        bus.append(f"[{k}]aresample=48000,aformat=channel_layouts=stereo,adelay={at}:all=1[s{k}]")
        return k

    for seg in segments(start, end):
        s0, s1 = seg["startMs"], seg["endMs"]
        skip = max(0, start - s0) / 1000
        length = (min(s1, end) - max(s0, start)) / 1000
        kind = seg["kind"]
        url = (seg.get("mp3") if kind == "song" else seg.get("file") if kind == "voice"
               else ("/voice/numbers_short.mp3" if seg.get("short") else "/voice/numbers_full.mp3") if kind == "numbers"
               else "/voice/ebs.mp3")
        add(local(url), max(s0, start), skip, length, music if kind == "song" else voice)
        tu = seg.get("talkup") if kind == "song" else None
        if tu:
            path = local(tu["file"])
            clip_at = s0 + tu["startOffsetMs"]
            post = clip_at + seconds(path) * 1000
            if post > start and clip_at < end:
                cskip = max(0, start - clip_at) / 1000
                add(path, max(clip_at, start), cskip, (min(post, end) - max(clip_at, start)) / 1000, voice)
                ducks.append(((max(clip_at, start) - start) / 1000, (min(post, end) - start) / 1000))

    fc, labels = [], []
    for chain in music + voice:
        fc.append(chain)
    m = [c.rsplit("[", 1)[1][:-1] for c in music]
    v = [c.rsplit("[", 1)[1][:-1] for c in voice]
    duck = "".join(f",volume={DUCK}:enable='between(t,{a+0.25:.2f},{b-0.6:.2f})'" for a, b in ducks if b - a > 1)
    if m:
        fc.append("".join(f"[{x}]" for x in m) + f"amix=inputs={len(m)}:normalize=0{duck}[mus]")
        labels.append("[mus]")
    if v:
        fc.append("".join(f"[{x}]" for x in v) + f"amix=inputs={len(v)}:normalize=0[vox]")
        labels.append("[vox]")
    color = "" if "--clean" in sys.argv else ",highpass=f=120,lowpass=f=5000,asoftclip=type=tanh"
    fc.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0,atrim=0:{dur},apad=whole_dur={dur}"
              f"{color},loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.5,afade=t=out:st={max(0, dur-1.5)}:d=1.5[out]")
    subprocess.run([FF, "-y", "-v", "error", *inputs, "-filter_complex", ";".join(fc), "-map", "[out]",
                    "-ar", "48000", "-ac", "2", out], check=True, startupinfo=SI, creationflags=0x08000000)
    print("wrote", out, f"{dur:.1f}s", len(music), "music", len(voice), "voice", len(ducks), "ducks")


if __name__ == "__main__":
    main()
