"""Rough cut v0 of the DEAD AIR demo: an assembly of real footage with real station audio, 24 fps.
A starting point for Ryan's edit, not the edit. No narration yet (that is Ryan's voice), no Runway.

  python rough_cut.py  ->  ~/.deadair/demo/rough_cut_v0.mp4
"""
import json, os, subprocess, sys

D = os.path.join(os.path.expanduser("~"), ".deadair", "demo")
VOICE = os.path.join(os.path.expanduser("~"), ".deadair", "voice_mp3")
FF = r"C:\Users\machi\Downloads\ffmpeg-8.0.1-essentials_build_CLEAN\bin\ffmpeg.exe"
SI = subprocess.STARTUPINFO(); SI.dwFlags |= subprocess.STARTF_USESHOWWINDOW; SI.wShowWindow = 0
V = "fps=24,scale=1920:1080:flags=lanczos,format=yuv420p,setsar=1"
ENC = ["-c:v", "libx264", "-crf", "16", "-preset", "slow", "-r", "24", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2"]
FONT = "C\\:/Windows/Fonts/segoeuib.ttf"
REQUEST_SONG_START = 1793552492140   # "You Make Me Better" after the 9:01 request read
EBS_REAL = 1793523541740             # the EBS the finale take was shifted to


def run(*a):
    subprocess.run([FF, "-y", "-v", "error", *a], check=True, startupinfo=SI, creationflags=0x08000000)


def render(start_ms, secs, out, clean=False):
    args = [sys.executable, os.path.join(D, "render_audio.py"), str(start_ms), f"{secs:.2f}", out]
    subprocess.run(args + (["--clean"] if clean else []), check=True, startupinfo=SI, creationflags=0x08000000)


def p(name):
    return os.path.join(D, name)


def fades(dur, vin=0.6, vout=0.6):
    return f"fade=t=in:st=0:d={vin},fade=t=out:st={dur - vout:.2f}:d={vout}"


def main():
    parts = []
    meta = lambda s: json.load(open(p(s + ".json")))

    # A. Tune in: the last stretch of the sweep, the lock, the station.
    sys.path.insert(0, D)
    from mux import seen_at, LOCK_REGION
    lock = seen_at(p("tune_in.mp4"), LOCK_REGION["tune_in"])  # the lock as seen on screen
    a0, a1 = max(0, lock - 12), lock + 14
    run("-ss", f"{a0:.2f}", "-to", f"{a1:.2f}", "-i", p("tune_in_sound.mp4"), "-vf", f"{V},{fades(a1-a0, 1.2)}",
        "-af", f"afade=t=in:d=1.2,afade=t=out:st={a1-a0-0.8:.2f}:d=0.8", *ENC, p("cut_a.mp4"))
    parts.append("cut_a.mp4")

    # B-D. The request (real 9:01 read) then Kiro and the tests, over the requested song, one continuous mix.
    b, c, dd = 20.4, 22.0, 16.0
    render(REQUEST_SONG_START - 15000, b + c + dd, p("cut_bcd.wav"))
    run("-t", f"{b}", "-i", p("request.mp4"), "-t", f"{c}", "-i", p("kiro.mp4"), "-t", f"{dd}", "-i", p("tests.mp4"),
        "-i", p("cut_bcd.wav"), "-filter_complex",
        f"[0]{V},{fades(b)}[x];[1]{V},{fades(c)}[y];[2]{V},{fades(dd)}[z];[x][y][z]concat=n=3:v=1:a=0[v];"
        f"[3]afade=t=in:d=0.6,volume='if(gt(t,{b}),0.55,1)':eval=frame,afade=t=out:st={b+c+dd-1.5:.2f}:d=1.5[a]",
        "-map", "[v]", "-map", "[a]", *ENC, p("cut_bcd.mp4"))
    parts.append("cut_bcd.mp4")

    # E. A hidden station logs a page.
    run("-i", p("hidden_sound.mp4"), "-vf", f"{V},{fades(16.9)}", "-af", "afade=t=in:d=0.8,afade=t=out:st=15.6:d=1.2",
        "-t", "16.9", *ENC, p("cut_e.mp4"))
    parts.append("cut_e.mp4")

    # F. The Logbook, under the short numbers reading and static.
    run("-i", p("logbook.mp4"), "-i", os.path.join(VOICE, "numbers_short.mp3"),
        "-f", "lavfi", "-i", "anoisesrc=c=pink:a=0.04:d=15,bandpass=f=1500:width_type=h:w=2400",
        "-filter_complex", f"[0]{V},{fades(14.1)}[v];[1]adelay=1500:all=1[n];[n][2]amix=inputs=2:normalize=0,"
        "aresample=48000,atrim=0:14.1,afade=t=in:d=0.6,afade=t=out:st=12.9:d=1.2[a]",
        "-map", "[v]", "-map", "[a]", "-t", "14.1", *ENC, p("cut_f.mp4"))
    parts.append("cut_f.mp4")

    # G-H. The finale: Marty, "...One more.", the song, then the title card while the song fades.
    fm = meta("finale")
    ebs_at = (fm["ebs_ms"] - fm["start_ms"]) / 1000
    g = (fm["end_ms"] - fm["start_ms"]) / 1000
    h = 7.0
    render(EBS_REAL + 30000, g - ebs_at - 30 + h, p("cut_song.wav"))
    title = (f"drawtext=fontfile='{FONT}':text='DEAD AIR':fontcolor=0xff7a1a:fontsize=120:x=(w-tw)/2:y=h/2-150,"
             f"drawtext=fontfile='{FONT}':text='1714 AM':fontcolor=0xe9e3d4:fontsize=54:x=(w-tw)/2:y=h/2-10,"
             f"drawtext=fontfile='{FONT}':text='Radio’s dead. Turn it up anyway.':fontcolor=0x7f7a70:fontsize=40:x=(w-tw)/2:y=h/2+80,"
             f"drawtext=fontfile='{FONT}':text='deadair.nohumannearby.com':fontcolor=0x7f7a70:fontsize=34:x=(w-tw)/2:y=h-140")
    run("-i", p("finale.mp4"), "-f", "lavfi", "-i", f"color=c=0x050607:s=1920x1080:r=24:d={h}",
        "-i", os.path.join(VOICE, "finale.mp3"), "-i", p("cut_song.wav"), "-filter_complex",
        f"[0]{V},fade=t=in:d=0.6,fade=t=out:st={g-0.8:.2f}:d=0.8[g];[1]{title},{V},fade=t=in:d=1.2,fade=t=out:st={h-1.5}:d=1.5[t];"
        f"[g][t]concat=n=2:v=1:a=0[v];"
        f"[2]aresample=48000,adelay={int(ebs_at*1000)}:all=1[f];[3]adelay={int((ebs_at+30)*1000)}:all=1[s];"
        f"[f][s]amix=inputs=2:normalize=0,atrim=0:{g+h:.2f},afade=t=in:d=0.4,afade=t=out:st={g+h-4:.2f}:d=4[a]",
        "-map", "[v]", "-map", "[a]", *ENC, p("cut_gh.mp4"))
    parts.append("cut_gh.mp4")

    lst = p("cut_list.txt")
    open(lst, "w").write("".join(f"file '{p(x)}'\n" for x in parts))
    out = p("rough_cut_v0.mp4")
    run("-f", "concat", "-safe", "0", "-i", lst, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:v", "copy",
        "-c:a", "aac", "-b:a", "256k", "-ar", "48000", out)
    print("wrote", out)


if __name__ == "__main__":
    main()
