"""Builds the audio for the Hunt (hidden stations), the numbers station, the EBS and the finale.

  pythonw build_hunt.py      (no console; log in hunt/build.log)

Takes Ryan's picks when they exist, else the best QA take. Writes mp3s into ~/.deadair/voice_mp3
(served at /voice/<id>.mp3) and durations into hunt/durations.json. Safe to rerun after new picks.
"""
import json, os, subprocess, sys

HOME = os.path.expanduser("~")
DA = os.path.join(HOME, ".deadair")
SESS = os.path.join(DA, "voice", "sessions")
RAW = os.path.join(DA, "hunt", "raw")
TMP = os.path.join(DA, "hunt", "tmp")
OUT = os.path.join(DA, "voice_mp3")
LIB = os.path.join(DA, "library_mp3")
FF = os.environ.get("FFMPEG", "ffmpeg")
FP = os.environ.get("FFPROBE", os.path.join(os.path.dirname(FF), os.path.basename(FF).replace("ffmpeg", "ffprobe")))
LOG = open(os.path.join(DA, "hunt", "build.log"), "a", encoding="utf-8")
SI = subprocess.STARTUPINFO(); SI.dwFlags |= subprocess.STARTF_USESHOWWINDOW; SI.wShowWindow = 0

def log(*a):
    print(*a, file=LOG, flush=True)

def ff(*args):
    r = subprocess.run([FF, "-y", "-v", "error", *args], startupinfo=SI, creationflags=0x08000000,
                       capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[-800:])

def dur(p):
    r = subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p],
                       startupinfo=SI, creationflags=0x08000000, capture_output=True, text=True)
    return float(r.stdout.strip())

def best(session, lid):
    """Ryan's pick (redo session wins), else the best QA take."""
    for name in (session + "_redo", session):
        d = os.path.join(SESS, name)
        try:
            man = json.load(open(os.path.join(d, "manifest.json"), encoding="utf-8"))["lines"]
        except Exception:
            continue
        if lid not in man:
            continue
        picks = {}
        try:
            picks = json.load(open(os.path.join(d, "picks.json"), encoding="utf-8"))
        except Exception:
            pass
        takes = man[lid]["takes"]
        if lid in picks:
            t = next((t for t in takes if str(t["take"]) == str(picks[lid])), None)
            if t:
                return os.path.join(d, t["file"])
        ok = [t for t in takes if t.get("qa", {}).get("ok")] or takes
        t = sorted(ok, key=lambda t: (-t.get("qa", {}).get("word_match", 0), t["take"]))[0]
        return os.path.join(d, t["file"])
    return None

MP3 = ["-ar", "44100", "-ac", "1", "-b:a", "128k"]
NORM = "loudnorm=I=-18:TP=-2:LRA=11"
DONE = {}

def finish(lid, path):
    DONE[lid] = round(dur(path), 3)
    log("ok", lid, DONE[lid])

def radio_voice(src, out, pre=1.5, post=1.5, rain=0.035, cut_silence=0.0):
    """Distant AM voice with rain under it; cut_silence > 0 means the signal dies and stays dead."""
    d = dur(src) + pre + post
    tail = f",apad=pad_dur={cut_silence}" if cut_silence else ""
    ff("-i", src, "-f", "lavfi", "-i", f"anoisesrc=c=pink:a={rain}:d={d}",
       "-filter_complex",
       f"[0]highpass=f=250,lowpass=f=3200,acompressor=threshold=-20dB:ratio=3,"
       f"adelay={int(pre*1000)}:all=1,apad=pad_dur={post}[v];[1]lowpass=f=1500,highpass=f=200[r];"
       f"[v][r]amix=inputs=2:duration=first:normalize=0,{NORM}{tail}", *MP3, out)

def tmp(name):
    os.makedirs(TMP, exist_ok=True)
    return os.path.join(TMP, name)

# ---------------------------------------------------------------- 1410: the old station
def build_1410():
    for i in range(1, 9):
        src = best("hidden_v1", f"storm_frag_{i}")
        if src:
            out = os.path.join(OUT, f"storm_frag_{i}.mp3")
            radio_voice(src, out)
            finish(f"storm_frag_{i}", out)
    src = best("hidden_v1", "last_minute")
    if src:  # the lightning: signal cuts mid-air, then dead air for the rest of 3:14
        out = os.path.join(OUT, "last_minute.mp3")
        radio_voice(src, out, post=0.0, cut_silence=max(4.0, 60.0 - 1.5 - dur(src)))
        finish("last_minute", out)

# ---------------------------------------------------------------- 666: between stations
def build_666():
    src = best("hidden_v2", "s666_forward")
    if not src:
        return
    d = dur(src) + 3
    out = os.path.join(OUT, "s666_reversed.mp3")
    ff("-i", src, "-f", "lavfi", "-i", f"sine=f=2200:d={d}", "-f", "lavfi", "-i", f"anoisesrc=c=white:a=0.02:d={d}",
       "-filter_complex",
       "[0]areverse,aecho=0.8:0.7:120|400:0.4|0.25,lowpass=f=2800,highpass=f=150,apad=pad_dur=3[v];"
       "[1]volume=0.008[s];[2]bandpass=f=1500:width_type=h:w=1200[n];"
       f"[v][s][n]amix=inputs=3:duration=first:normalize=0,{NORM}", *MP3, out)
    finish("s666_reversed", out)

# ---------------------------------------------------------------- 870: Marty's service radio
MARTY = "rubberband=pitch=0.84:formant=shifted"

def build_870():
    total = 110
    words = [(w, best("other_clone_v1", w)) for w in ("marty_word_1", "marty_word_2", "marty_word_3")]
    words = [(w, p) for w, p in words if p]
    ins = ["-f", "lavfi", "-i", f"anoisesrc=c=brown:a=0.35:d={total}",
           "-f", "lavfi", "-i", f"anoisesrc=c=white:a=0.5:d={total}"]
    fc = ("[0]lowpass=f=700,tremolo=f=0.15:d=0.7,volume=0.7[wind];"
          "[1]bandpass=f=1800:width_type=h:w=1400,volume='if(lt(mod(t,17),0.35)+between(mod(t,29),0,0.25),0.25,0)':eval=frame[sq]")
    mix, n = "[wind][sq]", 2
    for i, (w, p) in enumerate(words):
        at = (20, 50, 85)[i] * 1000
        ins += ["-i", p]
        fc += (f";[{2+i}]{MARTY},highpass=f=500,lowpass=f=2500,acrusher=bits=8:mix=0.25,"
               f"volume=1.4,adelay={at}:all=1[w{i}]")
        mix += f"[w{i}]"; n += 1
    fc += f";{mix}amix=inputs={n}:duration=first:normalize=0,{NORM},afade=t=in:d=1,afade=t=out:st={total-2}:d=2"
    out = os.path.join(OUT, "marty_radio_1.mp3")
    ff(*ins, "-filter_complex", fc, *MP3, out)
    finish("marty_radio_1", out)

# ---------------------------------------------------------------- 1031: the 1985 bulletin, degrading
def build_1031():
    src = os.path.join(RAW, "bulletin_01.wav")
    if not os.path.exists(src):
        return
    parts = []
    tone = tmp("b_tone.wav")
    ff("-f", "lavfi", "-i", "sine=f=1050:d=3", "-af", "volume=0.25,apad=pad_dur=0.6", "-ar", "44100", "-ac", "1", tone)
    parts.append(tone)
    for k, (lp, noise, trem) in enumerate([(3000, 0.01, 0.0), (2000, 0.04, 0.3), (1200, 0.09, 0.7)]):
        d = dur(src) + 1.2
        p = tmp(f"b_rep{k}.wav")
        t = f",tremolo=f=0.6:d={trem}" if trem else ""
        ff("-i", src, "-f", "lavfi", "-i", f"anoisesrc=c=pink:a={noise}:d={d}", "-filter_complex",
           f"[0]highpass=f=300,lowpass=f={lp},apad=pad_dur=1.2{t}[v];[1]highpass=f=300[n];"
           "[v][n]amix=inputs=2:duration=first:normalize=0", "-ar", "44100", "-ac", "1", p)
        parts.append(p)
    lst = tmp("b_list.txt")
    open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
    out = os.path.join(OUT, "bulletin_1.mp3")
    ff("-f", "concat", "-safe", "0", "-i", lst, "-af", NORM, *MP3, out)
    finish("bulletin_1", out)

# ---------------------------------------------------------------- 540: request line hold music
def build_540():
    song = os.path.join(LIB, "i-call-you-here-and-there.mp3")
    if not os.path.exists(song):
        return
    total = 150
    ins = ["-t", str(total), "-i", song, "-f", "lavfi", "-i", f"anoisesrc=c=white:a=0.01:d={total}"]
    fc = ("[0]aresample=8000,highpass=f=300,lowpass=f=3400,acompressor=threshold=-24dB:ratio=4,"
          "aresample=44100,pan=mono|c0=0.5*c0+0.5*c1,volume=0.7[m];[1]bandpass=f=2000:width_type=h:w=2000[h]")
    mix, n = "[m][h]", 2
    for i, (w, at) in enumerate([("caller_willow", 45), ("caller_thanks", 110)]):
        p = best("other_clone_v1", w)
        if not p:
            continue
        ins += ["-i", p]
        fc += (f";[{2+i}]rubberband=pitch=1.12:formant=shifted,aresample=8000,highpass=f=350,lowpass=f=3000,"
               f"aresample=44100,volume=1.3,adelay={at*1000}:all=1[c{i}]")
        mix += f"[c{i}]"; n += 1
    fc += f";{mix}amix=inputs={n}:duration=first:normalize=0,{NORM},afade=t=in:d=1,afade=t=out:st={total-3}:d=3"
    out = os.path.join(OUT, "hold_1.mp3")
    ff(*ins, "-filter_complex", fc, *MP3, out)
    finish("hold_1", out)

# ---------------------------------------------------------------- 710: Starlite Roller Rink PA
def build_710():
    song = os.path.join(LIB, "rolling-silver.mp3")
    if not os.path.exists(song):
        return
    total = 150
    PA = "highpass=f=250,lowpass=f=3800,aecho=0.8:0.85:60|180:0.35|0.2"
    ins = ["-t", str(total), "-i", song, "-f", "lavfi", "-i", f"anoisesrc=c=brown:a=0.15:d={total}"]
    fc = (f"[0]pan=mono|c0=0.5*c0+0.5*c1,{PA},vibrato=f=0.4:d=0.05,volume=0.6[m];"
          "[1]lowpass=f=250,tremolo=f=3:d=0.3[sk]")
    mix, n = "[m][sk]", 2
    for i, (w, at) in enumerate([("rink_01", 3), ("rink_02", 70), ("rink_03", 120)]):
        p = best("other_clone_v1", w)
        if not p:
            continue
        ins += ["-i", p]
        fc += f";[{2+i}]rubberband=pitch=1.08:formant=shifted,{PA},volume=1.5,adelay={at*1000}:all=1[a{i}]"
        mix += f"[a{i}]"; n += 1
    fc += f";{mix}amix=inputs={n}:duration=first:normalize=0,{NORM},afade=t=in:d=1,afade=t=out:st={total-3}:d=3"
    pa = tmp("rink_pa.wav")
    ff(*ins, "-filter_complex", fc, "-ar", "44100", "-ac", "1", pa)
    parts = [pa]
    intro = best("hidden_v2", "s710_john_intro")
    if intro:
        j = tmp("rink_john.mp3")
        radio_voice(intro, j, pre=0.8, post=0.8, rain=0.0)
        jw = tmp("rink_john.wav")
        ff("-i", j, "-ar", "44100", "-ac", "1", jw)
        parts = [jw, pa]
    lst = tmp("rink_list.txt")
    open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
    out = os.path.join(OUT, "rink_1.mp3")
    ff("-f", "concat", "-safe", "0", "-i", lst, *MP3, out)
    finish("rink_1", out)

# ---------------------------------------------------------------- 1714: numbers station (exactly 60 s)
def interval_signal(name, reps):
    """A three-note music-box call sign, like real numbers stations use."""
    notes = "".join(f"sine=f={f}:d={d}[n{i}];" for i, (f, d) in enumerate([(880, .35), (660, .35), (990, .5)]))
    p = tmp(name)
    ff("-f", "lavfi", "-i", f"{notes}[n0][n1][n2]concat=n=3:v=0:a=1,afade=t=out:st=1.0:d=0.2,apad=pad_dur=0.4,"
       f"aloop=loop={reps-1}:size={int(1.6*44100)},volume=0.18", "-ar", "44100", "-ac", "1", p)
    return p

def build_numbers():
    src = os.path.join(RAW, "numbers_full.wav")
    if not os.path.exists(src):
        return
    sig = interval_signal("num_sig.wav", 3)
    out = os.path.join(OUT, "numbers_full.mp3")
    ff("-i", sig, "-i", src, "-i", sig, "-f", "lavfi", "-i", "anoisesrc=c=pink:a=0.03:d=60",
       "-filter_complex",
       "[1]highpass=f=300,lowpass=f=3000,acrusher=bits=10:mix=0.2,volume=1.2,adelay=6000:all=1[v];"
       "[2]adelay=52000:all=1[s2];[3]bandpass=f=1500:width_type=h:w=2400,tremolo=f=0.1:d=0.5[bed];"
       "[0][v][s2][bed]amix=inputs=4:duration=longest:normalize=0,atrim=0:60,apad=whole_dur=60,"
       "loudnorm=I=-20:TP=-2,afade=t=out:st=58:d=2", *MP3, out)
    finish("numbers_full", out)
    s = os.path.join(RAW, "numbers_short.wav")
    if os.path.exists(s):
        sig1 = interval_signal("num_sig1.wav", 1)
        out = os.path.join(OUT, "numbers_short.mp3")
        ff("-i", sig1, "-i", s, "-f", "lavfi", "-i", "anoisesrc=c=pink:a=0.03:d=10", "-filter_complex",
           "[1]highpass=f=300,lowpass=f=3000,acrusher=bits=10:mix=0.2,volume=1.2,adelay=2000:all=1[v];"
           "[2]bandpass=f=1500:width_type=h:w=2400[bed];[0][v][bed]amix=inputs=3:duration=longest:normalize=0,"
           "atrim=0:10,loudnorm=I=-20:TP=-2,afade=t=out:st=9:d=1", *MP3, out)
        finish("numbers_short", out)

# ---------------------------------------------------------------- 1714: EBS (exactly 30 s) and the finale
TWO_TONE = "sine=f=853:d={d}[a];sine=f=960:d={d}[b];[a][b]amix=inputs=2,lowpass=f=3000,volume=0.22"

def build_ebs():
    src = os.path.join(RAW, "ebs_voice.wav")
    if not os.path.exists(src):
        return
    out = os.path.join(OUT, "ebs.mp3")
    ff("-f", "lavfi", "-i", TWO_TONE.format(d=8), "-i", src, "-f", "lavfi", "-i", "anoisesrc=c=pink:a=0.02:d=30",
       "-filter_complex",
       "[1]highpass=f=300,lowpass=f=3200,volume=1.3,adelay=9000:all=1[v];[2]highpass=f=300[bed];"
       "[0][v][bed]amix=inputs=3:duration=longest:normalize=0,atrim=0:30,apad=whole_dur=30,"
       "loudnorm=I=-19:TP=-2,afade=t=out:st=28:d=2", *MP3, out)
    finish("ebs", out)

def build_finale():
    marty = best("other_clone_v1", "marty_finale")
    john = best("hidden_v1", "finale_john")
    if not (marty and john):
        return
    # Fills the whole 30 s EBS slot: tone, static that holds and builds, then Marty breaks through
    # clear, and John's "...One more." lands a second before the slot ends and the song starts.
    total = 30.0
    m_at = total - 1.0 - dur(john) - 1.8 - dur(marty) - 0.6  # 0.6: rubberband pitch-down lengthens Marty a little
    j_at = total - 1.0 - dur(john)
    out = os.path.join(OUT, "finale.mp3")
    ff("-f", "lavfi", "-i", TWO_TONE.format(d=6), "-i", marty, "-i", john,
       "-f", "lavfi", "-i", f"anoisesrc=c=pink:a=0.05:d={total}",
       "-filter_complex",
       "[0]afade=t=out:st=3:d=3[t];"
       f"[1]{MARTY},aecho=0.8:0.6:30:0.15,volume=1.2,adelay={int(m_at*1000)}:all=1[m];"
       f"[2]volume=1.1,adelay={int(j_at*1000)}:all=1[j];"
       f"[3]highpass=f=300,afade=t=in:st=3:d=4,tremolo=f=0.3:d=0.4,afade=t=out:st={m_at - 0.5:.2f}:d=2.5[st];"
       f"[t][m][j][st]amix=inputs=4:duration=longest:normalize=0,atrim=0:{total},apad=whole_dur={total},{NORM}", *MP3, out)
    finish("finale", out)

def main():
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[1:])
    for name, fn in [("1410", build_1410), ("666", build_666), ("870", build_870), ("1031", build_1031),
                     ("540", build_540), ("710", build_710), ("numbers", build_numbers), ("ebs", build_ebs),
                     ("finale", build_finale)]:
        if only and name not in only:
            continue
        try:
            fn()
        except Exception as e:
            log("FAIL", name, repr(e))
    path = os.path.join(DA, "hunt", "durations.json")
    old = json.load(open(path)) if os.path.exists(path) else {}
    old.update(DONE)
    json.dump(old, open(path, "w"), indent=1)
    log("done", len(DONE))

if __name__ == "__main__":
    main()
