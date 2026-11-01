"""Give a captured scene its real sound: static while tuning, then exactly what was on the air.

  python mux.py tune_in      static fades out at the lock, 1714 fades in (rendered from the schedule)
  python mux.py hidden       static stays, the hidden station rises under it from the lock moment

Reads <scene>.json (clock span + lock_ms from capture.py) and writes <scene>_sound.mp4.
"""
import json, os, subprocess, sys, urllib.request

D = os.path.join(os.path.expanduser("~"), ".deadair", "demo")
VOICE = os.path.join(os.path.expanduser("~"), ".deadair", "voice_mp3")
FF = r"C:\Users\machi\Downloads\ffmpeg-8.0.1-essentials_build_CLEAN\bin\ffmpeg.exe"
SI = subprocess.STARTUPINFO(); SI.dwFlags |= subprocess.STARTF_USESHOWWINDOW; SI.wShowWindow = 0
STATIC = "anoisesrc=c=white:a=0.5:d={d},bandpass=f=600:width_type=q:w=1.2,highpass=f=120,lowpass=f=5000,volume={v}"


def run(*a):
    subprocess.run([FF, "-y", "-v", "error", *a], check=True, startupinfo=SI, creationflags=0x08000000)


def seen_at(video, crop, jump=25):
    """First time (s) a screen region brightens by `jump` luma: the lock as the viewer sees it.
    The capture's wall-clock mark runs ahead of the picture (queued key events), so the picture decides."""
    r = subprocess.run([FF, "-v", "error", "-i", video, "-vf",
                        f"fps=12,crop={crop},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
                        "-f", "null", "NUL"], capture_output=True, text=True, startupinfo=SI, creationflags=0x08000000)
    t, base = None, None
    for line in r.stdout.splitlines():
        if "pts_time:" in line:
            t = float(line.rsplit("pts_time:", 1)[1])
        elif "YAVG=" in line:
            y = float(line.split("=", 1)[1])
            base = y if base is None else base
            if y - base >= jump:
                return t
    raise RuntimeError(f"no lock seen in {video}")


# Screen regions in the 1920x1080 takes: the ON AIR lamp, and the left half of the SIGNAL meter.
LOCK_REGION = {"tune_in": "120:50:910:75", "hidden": "260:10:380:433"}


def main(scene):
    meta = json.load(open(os.path.join(D, scene + ".json")))
    video = os.path.join(D, scene + ".mp4")
    total = float(subprocess.run([FF.replace("ffmpeg.exe", "ffprobe.exe"), "-v", "error", "-show_entries",
                                  "format=duration", "-of", "csv=p=0", video], capture_output=True, text=True,
                                 startupinfo=SI, creationflags=0x08000000).stdout)
    lock = seen_at(video, LOCK_REGION[scene])
    print(scene, "lock seen at", round(lock, 2), "s")
    out = os.path.join(D, scene + "_sound.mp4")
    tail = total - lock

    if scene == "tune_in":
        station = os.path.join(D, "tune_in_station.wav")
        subprocess.run([sys.executable, os.path.join(D, "render_audio.py"), str(meta["lock_ms"]), f"{tail:.2f}", station],
                       check=True, startupinfo=SI, creationflags=0x08000000)
        # Static from power-on, falling as the needle closes in, gone 1.2 s after lock (the tuner's LOCK_FADE_S).
        run("-i", video, "-f", "lavfi", "-i", STATIC.format(d=total, v=0.35), "-i", station, "-filter_complex",
            f"[1]volume='if(lt(t,{lock-4:.2f}),1,max(0,1-(t-{lock-4:.2f})/5.2))':eval=frame[s];"
            f"[2]adelay={int(lock*1000)}:all=1,afade=t=in:st={lock:.2f}:d=1.2[m];"
            f"[s][m]amix=inputs=2:normalize=0,atrim=0:{total:.2f},loudnorm=I=-16:TP=-1.5[a]",
            "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", out)
    else:
        sig = json.load(urllib.request.urlopen(f"http://127.0.0.1:8787/signal?f=1410&t={meta['lock_ms']}"))
        clip = os.path.join(VOICE, sig["file"].rsplit("/", 1)[-1])
        skip = sig["offset_ms"] / 1000
        # The faint station: thin band, never louder than the static around it.
        run("-i", video, "-f", "lavfi", "-i", STATIC.format(d=total, v=0.35), "-stream_loop", "-1", "-ss", f"{skip:.2f}",
            "-i", clip, "-filter_complex",
            f"[1]volume='if(lt(t,{lock-3:.2f}),1,0.55)':eval=frame[s];"
            f"[2]bandpass=f=1100:width_type=q:w=0.7,volume=1.6,adelay={int((lock-1.5)*1000)}:all=1,"
            f"afade=t=in:st={lock-1.5:.2f}:d=2.5,atrim=0:{total:.2f}[h];"
            f"[s][h]amix=inputs=2:normalize=0,atrim=0:{total:.2f},loudnorm=I=-18:TP=-1.5[a]",
            "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", out)
    print("wrote", out)


if __name__ == "__main__":
    for s in sys.argv[1:]:
        main(s)
