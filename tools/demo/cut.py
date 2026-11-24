"""The final DEAD AIR demo edit (v3, Nov 24 2026, published at https://youtu.be/QEpuRzHnwc0): the locked-in hook, Runway shots at their beats, 4K screen takes.
Every clip plays at native speed (cuts and slow digital push-ins only). 24 fps, 1080p, -16 LUFS.
Captions instead of narration. Writes rough_cut_v3.mp4 into ~/.deadair/demo (footage lives there, not in git).
"""
import json, os, subprocess, sys

D = os.path.join(os.path.expanduser("~"), ".deadair", "demo")
R = os.path.join(D, "runway")
V = os.path.join(os.path.expanduser("~"), ".deadair", "voice_mp3")
L = os.path.join(os.path.expanduser("~"), ".deadair", "library_mp3")
FF = os.environ.get("FFMPEG", "ffmpeg")
FP = os.environ.get("FFPROBE", os.path.join(os.path.dirname(FF), os.path.basename(FF).replace("ffmpeg", "ffprobe")))
NW = 0x08000000
FONT = "C\\:/Windows/Fonts/segoeuib.ttf"
sys.path.insert(0, D)
from mux import seen_at  # the lock as seen on screen


def dur(p):
    r = subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p],
                       capture_output=True, text=True, creationflags=NW)
    return float(r.stdout)


def p(n):
    return os.path.join(D, n)


lock = seen_at(p("tune_in_4k.mp4"), "240:100:1820:150")
hlock = seen_at(p("hidden_4k.mp4"), "520:20:760:866")
ebs = json.load(open(p("finale_4k.json")))
ebs_at = (ebs["ebs_ms"] - ebs["start_ms"]) / 1000 if "ebs_ms" in ebs else 0.8
print("lock", lock, "hidden lock", hlock, "ebs", ebs_at)

# (source, skip, seconds, push): push = how far the frame closes in over the shot (0 = as shot)
CUTS = [
    (p("tune_in_4k.mp4"), lock - 2.2, 2.4, 0.10),          # hook: the needle slams onto 1714
    (os.path.join(R, "D1_station_exterior.mp4"), 1.0, 3.0, 0),
    (os.path.join(R, "D2_dead_john.mp4"), 1.0, 4.2, 0),
    (os.path.join(R, "D3_cold_coffee.mp4"), 0.5, 3.0, 0),
    (p("tune_in_4k.mp4"), lock + 3.0, 7.0, 0.14),          # the card: "made Mar 6, 2026"
    (p("request_4k.mp4"), 1.0, 13.0, 0.10),                # someone calls the request line
    (p("gh/specs.png"), 0, 3.0, 0.08),                     # Kiro: steady 4K stills (the scroll take stuttered)
    (p("gh/steering.png"), 0, 3.0, 0.08),
    (p("gh/hooks.png"), 0, 3.0, 0.08),
    (p("gh/clock_props.png"), 0, 3.0, 0.08),
    (p("gh/mcp.png"), 0, 3.0, 0.08),
    (p("tests_4k.mp4"), dur(p("tests_4k.mp4")) - 5.5, 5.0, 0.06),
    (p("hidden_4k.mp4"), max(0, hlock - 5), 12.0, 0.12),   # the Hunt: something faint
    (p("logbook_4k.mp4"), 2.2, 7.3, 0.08),                 # ends before the take scrolls (blur stays put)
    (p("finale_4k.mp4"), ebs_at + 0.5, 2.8, 0.08),         # the tone; Marty's card
    (os.path.join(R, "D4_tower_light.mp4"), 0.0, 8.0, 0),
    (p("finale_4k.mp4"), ebs_at + 12, 2.5, 0.08),
    (os.path.join(R, "D5_kiro_ghost.mp4"), 1.0, 2.5, 0),   # the ghost, near the end, no fuss
]
TITLE = 7.0
t = sum(c[2] for c in CUTS)
total = t + TITLE
marks, acc = [], 0.0
for c in CUTS:
    marks.append(acc)
    acc += c[2]
print("video", round(total, 1), "s")

# Spoiler guard: blur where the hidden stations sit on the dial (source 3840x2160 pixels: x, y, w, h).
BLUR = {
    "hidden_4k.mp4": [(600, 300, 280, 140)],                       # the frequency readout
    "logbook_4k.mp4": [(250, 990, 720, 120), (1120, 915, 690, 110), (2860, 1765, 690, 115)],  # "logged ..., N on the dial"
}

def masked(i, src):
    boxes = BLUR.get(os.path.basename(src))
    if not boxes:
        return f"[{i}:v]"
    chain, cur = [], f"[{i}:v]"
    for j, (x, y, w, h) in enumerate(boxes):
        chain.append(f"{cur}split[m{i}a{j}][m{i}b{j}];[m{i}b{j}]crop={w}:{h}:{x}:{y},boxblur=24:4[m{i}c{j}];"
                     f"[m{i}a{j}][m{i}c{j}]overlay={x}:{y}[m{i}o{j}]")
        cur = f"[m{i}o{j}]"
    vf.append(";".join(chain))
    return cur

inputs, vf = [], []
for i, (src, skip, secs, push) in enumerate(CUTS):
    if src.endswith(".png"):
        inputs += ["-loop", "1", "-framerate", "24", "-t", f"{secs:.3f}", "-i", src]
    else:
        inputs += ["-ss", f"{skip:.3f}", "-t", f"{secs:.3f}", "-i", src]
    if push:
        # Slow digital push-in: grow the frame over the shot, keep the center 1920x1080.
        z = f"(1+{push}*t/{secs})"
        vf.append(f"{masked(i, src)}fps=24,setpts=PTS-STARTPTS,scale=w='trunc(1920*{z}/2)*2':h='trunc(1080*{z}/2)*2':eval=frame:flags=bicubic,crop=1920:1080,format=yuv420p,setsar=1[v{i}]")
    else:
        vf.append(f"{masked(i, src)}fps=24,scale=1920:1080:flags=lanczos,format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v{i}]")
n = len(CUTS)
title = (f"color=c=0x050607:s=1920x1080:r=24:d={TITLE},"
         f"drawtext=fontfile='{FONT}':text='DEAD AIR':fontcolor=0xff7a1a:fontsize=120:x=(w-tw)/2:y=h/2-150,"
         f"drawtext=fontfile='{FONT}':text='1714 AM':fontcolor=0xe9e3d4:fontsize=54:x=(w-tw)/2:y=h/2-10,"
         f"drawtext=fontfile='{FONT}':text='Radio\u2019s dead. Turn it up anyway.':fontcolor=0x7f7a70:fontsize=40:x=(w-tw)/2:y=h/2+80,"
         f"drawtext=fontfile='{FONT}':text='deadair.nohumannearby.com':fontcolor=0x7f7a70:fontsize=34:x=(w-tw)/2:y=h-140,"
         f"format=yuv420p,setsar=1,fade=t=in:d=1,fade=t=out:st={TITLE-1.5}:d=1.5[vt]")
vf.append(title)
vf.append("".join(f"[v{i}]" for i in range(n)) + f"[vt]concat=n={n+1}:v=1:a=0[vc]")

# Captions: one plain line per beat so a judge seeing it cold knows what they are watching.
# No hidden frequencies, page titles or hints. Text files avoid drawtext escaping.
CAPS = [
    (marks[1] + 0.2, marks[4] - 0.2, "A pirate AM station, past the end of the dial."),
    (marks[4] + 0.2, marks[5] - 0.2, "Dead John plays 1,101 original songs and reads each title like a letter."),
    (marks[5] + 0.2, marks[6] - 0.2, "Call the station. He reads your request on the air, for everyone."),
    (marks[6] + 0.2, marks[11] - 0.2, "Built with Kiro: 7 specs, steering, hooks and an MCP server."),
    (marks[11] + 0.2, marks[12] - 0.2, "Property tests keep the clock honest. Every listener hears the same moment."),
    (marks[12] + 0.2, marks[13] - 0.2, "Most of the dial is static. Some of it isn't."),
    (marks[13] + 0.2, marks[14] - 0.2, "Find the hidden signals. Fill the Logbook."),
    (marks[15] + 0.2, marks[16] - 0.2, "Find them all, and someone finally answers."),
]
CAPDIR = p("captions")
os.makedirs(CAPDIR, exist_ok=True)
cap = []
for i, (a, b, text) in enumerate(CAPS):
    f = os.path.join(CAPDIR, f"c{i}.txt")
    open(f, "w", encoding="utf-8").write(text)
    tf = f.replace("\\", "/").replace(":", "\\:")
    alpha = f"if(lt(t,{a}+0.4),(t-{a})/0.4,if(gt(t,{b}-0.4),({b}-t)/0.4,1))"
    cap.append(f"drawtext=fontfile='{FONT}':textfile='{tf}':fontcolor=0xe9e3d4:fontsize=46:"
               f"x=(w-tw)/2:y=h-150:box=1:boxcolor=0x050607@0.62:boxborderw=22:"
               f"enable='between(t,{a},{b})':alpha='{alpha}'")
vf.append("[vc]" + ",".join(cap) + "[v]")

# Audio layers: (file, at, skip, seconds, filter). Everything is the real station material.
open_at = 0.15
signon = os.path.join(V, "signon_alt2.mp3")      # "If you can hear this, you found us. I'm Dead John..."
song = os.path.join(L, "hey-mom.mp3")
lib = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "library.json"), encoding="utf-8"))
post = next(x for x in lib if x["id"] == "hey-mom")["talkup_seconds"]
req_at = marks[5] - 0.5
req_len = marks[12] - req_at
hunt_at = marks[12]
log_at = marks[13]
fin_at = marks[14]
mfin = 30.0 - 1.0 - 1.2 - 1.8 - 5.5 - 0.6      # about where Marty comes in on finale.mp3
rest_at = marks[15]
song_end_at = t - 0.6
# John's "Okay, Marty. ...One more." ends 0.3 s before the song comes back (finale.mp3 puts it 1 s before 30 s).
john_d = dur(os.path.join(os.path.expanduser("~"), ".deadair", "voice", "sessions", "hidden_v1_redo", "finale_john_take1.wav"))
j_at = 30.0 - 1.0 - john_d
fin_skip = j_at - (song_end_at - 0.3 - john_d - rest_at)
print("finale skip", round(fin_skip, 2), "john in cut at", round(song_end_at - 0.3 - john_d, 2))
LAYERS = [
    # Hook: a burst of static with his voice inside it, then clean, and the song hits on the lock.
    ("noise", 0.0, 0, 2.3, "volume=0.5,afade=t=out:st=1.9:d=0.3"),
    (signon, open_at, 0, min(dur(signon), req_at), "volume=1.5"),
    (song, 2.2, max(0, post - 0.2), req_at - 2.2 + 1.0, f"volume='if(lt(t,{dur(signon)-1.8:.2f}),0.32,0.85)':eval=frame,afade=t=out:st={req_at-2.2-0.5:.2f}:d=1.5"),
    # The request read and its song, running under Kiro and the tests.
    (p("request_sam.wav"), req_at, 0, req_len + 1.0, f"volume='if(gt(t,{marks[6]-req_at:.2f}),0.6,1)':eval=frame,afade=t=in:d=0.5,afade=t=out:st={req_len-0.5:.2f}:d=1.5"),
    # The Hunt: real static and the real fragment.
    (p("hidden_sound.mp4"), hunt_at, max(0, hlock - 5), 12.0, "afade=t=in:d=0.5,afade=t=out:st=11.2:d=0.8"),
    (os.path.join(V, "numbers_short.mp3"), log_at + 0.5, 0, 7.0, "volume=1.2,afade=t=out:st=6.0:d=1"),
    # Finale: the tone, then static building, Marty breaking through, dead air, "...One more."
    (os.path.join(V, "finale.mp3"), fin_at, 0, 2.8, "afade=t=out:st=2.2:d=0.6"),
    (os.path.join(V, "finale.mp3"), rest_at, fin_skip, 30 - fin_skip, "afade=t=in:d=0.4"),
    (song, song_end_at, post + 20, TITLE + 0.6, f"volume=0.85,afade=t=in:d=0.3,afade=t=out:st={TITLE-3.4}:d=4"),
]
af = []
k = n
for lay in LAYERS:
    src, at, skip, secs, flt = lay
    if src == "noise":
        inputs += ["-f", "lavfi", "-t", f"{secs:.3f}", "-i", "anoisesrc=c=white:a=0.5,bandpass=f=900:width_type=q:w=0.9"]
    else:
        inputs += ["-ss", f"{skip:.3f}", "-t", f"{secs:.3f}", "-i", src]
    af.append(f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,{flt},adelay={int(at*1000)}:all=1[a{k}]")
    k += 1
af.append("".join(f"[a{i}]" for i in range(n, k)) + f"amix=inputs={k-n}:normalize=0:duration=longest,atrim=0:{total:.2f},"
          f"loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st={total-1}:d=1[a]")

out = p("rough_cut_v3.mp4")
r = subprocess.run([FF, "-y", "-v", "error", *inputs, "-filter_complex", ";".join(vf + af), "-map", "[v]", "-map", "[a]",
                    "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-r", "24", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", out],
                   capture_output=True, text=True, creationflags=NW)
if r.returncode:
    sys.exit("ffmpeg failed: " + r.stderr[-1500:])
print("wrote", out, round(dur(out), 1), "s")
print("beats:", [round(m, 1) for m in marks])
