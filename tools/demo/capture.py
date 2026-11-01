"""Raw demo footage of the DEAD AIR tuner, for Ryan's edit.

  python capture.py <scene> [<scene> ...]      scenes: tune_in, hidden, logbook, request, finale

Opens its own Chrome tab (CDP :9333, never Ryan's tabs), sets a 1920x1080 viewport, records the
page with Page.startScreencast and writes ~/.deadair/demo/<scene>.mp4 at 24 fps, H.264 CRF 14.
Screencast frames arrive only when the page repaints, so each frame is held until the next one
(a screen recording sampled to 24 fps; nothing is retimed). Audio is not captured here.
"""
import base64, json, os, subprocess, sys, threading, time, urllib.request
import websocket

OUT = os.path.join(os.path.expanduser("~"), ".deadair", "demo")
FF = r"C:\Users\machi\Downloads\ffmpeg-8.0.1-essentials_build_CLEAN\bin\ffmpeg.exe"
SITE = "http://localhost:17362/"
HIDDEN = subprocess.STARTUPINFO()
HIDDEN.dwFlags |= subprocess.STARTF_USESHOWWINDOW
HIDDEN.wShowWindow = 0


class Tab:
    def __init__(self):
        req = urllib.request.Request("http://127.0.0.1:9333/json/new?about:blank", method="PUT")
        self.info = json.load(urllib.request.urlopen(req))
        self.ws = websocket.create_connection(self.info["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
        self.n = 0
        self.lock = threading.Lock()
        self.pending = {}
        self.frames = []
        self.recording = False
        self.marks = {}
        threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self):
        while True:
            try:
                msg = json.loads(self.ws.recv())
            except Exception:
                return
            if msg.get("method") == "Page.screencastFrame":
                p = msg["params"]
                self.send("Page.screencastFrameAck", {"sessionId": p["sessionId"]}, wait=False)
                if self.recording:
                    self.frames.append((p["metadata"]["timestamp"], p["data"]))
            elif "id" in msg and msg["id"] in self.pending:
                self.pending[msg["id"]].append(msg)

    def send(self, method, params=None, wait=True):
        with self.lock:
            self.n += 1
            i = self.n
            self.pending[i] = []
            self.ws.send(json.dumps({"id": i, "method": method, "params": params or {}}))
        if not wait:
            return None
        end = time.time() + 30
        while time.time() < end:
            if self.pending[i]:
                return self.pending.pop(i)[0]
            time.sleep(0.01)
        return {}

    def ev(self, expr):
        r = self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        return r.get("result", {}).get("result", {}).get("value")

    def click(self, sel):
        self.ev(f"document.querySelector({json.dumps(sel)}).scrollIntoView({{block:'center',behavior:'smooth'}})")
        time.sleep(0.6)
        x, y = self.ev(f"(()=>{{const b=document.querySelector({json.dumps(sel)}).getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]}})()")
        self.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})
        time.sleep(0.25)
        for t in ("mousePressed", "mouseReleased"):
            self.send("Input.dispatchMouseEvent", {"type": t, "x": x, "y": y, "button": "left", "clickCount": 1})

    def key(self, k, code):
        for t in ("keyDown", "keyUp"):
            self.send("Input.dispatchKeyEvent", {"type": t, "key": k, "code": k, "windowsVirtualKeyCode": code}, wait=False)

    def type(self, text, delay=0.07):
        for ch in text:
            self.send("Input.insertText", {"text": ch})
            time.sleep(delay)

    def sweep(self, target, fast=0.012, slow=0.06, slow_within=25):
        """Walk the dial one kHz at a time like a hand on the knob, easing in near the target."""
        cur = round(self.ev("__deadair.freq"))
        self.ev("window.scrollTo(0, document.getElementById('radio').offsetTop - 12)")
        while cur != target:
            right = target > cur
            self.key("ArrowRight" if right else "ArrowLeft", 39 if right else 37)
            cur += 1 if right else -1
            time.sleep(slow if abs(target - cur) < slow_within else fast)
        time.sleep(0.3)
        actual = round(self.ev("__deadair.freq"))
        while actual != target:  # a dropped key: settle exactly on the target
            right = target > actual
            self.key("ArrowRight" if right else "ArrowLeft", 39 if right else 37)
            time.sleep(0.1)
            actual = round(self.ev("__deadair.freq"))

    def close(self):
        urllib.request.urlopen("http://127.0.0.1:9333/json/close/" + self.info["id"])


def open_site(tab, inject=None):
    tab.send("Page.enable")
    tab.send("Network.enable")
    tab.send("Network.setCacheDisabled", {"cacheDisabled": True})
    tab.send("Emulation.setDeviceMetricsOverride", {"width": 960, "height": 540, "deviceScaleFactor": 2, "mobile": False})
    tab.send("Emulation.setScrollbarsHidden", {"hidden": True})
    if inject:
        tab.send("Page.addScriptToEvaluateOnNewDocument", {"source": inject})
    tab.send("Page.navigate", {"url": SITE})
    time.sleep(5)
    urllib.request.urlopen("http://127.0.0.1:9333/json/activate/" + tab.info["id"])


def record_start(tab):
    tab.frames = []
    tab.recording = True
    tab.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": 1920, "maxHeight": 1080, "everyNthFrame": 1})


def record_stop(tab, name):
    end_ts = time.time()
    tab.recording = False
    tab.send("Page.stopScreencast")
    frames = tab.frames
    if not frames:
        print(name, "no frames")
        return
    d = os.path.join(OUT, name + "_frames")
    os.makedirs(d, exist_ok=True)
    lines = []
    for k, (ts, data) in enumerate(frames):
        p = os.path.join(d, f"{k:06d}.jpg")
        open(p, "wb").write(base64.b64decode(data))
        nxt = frames[k + 1][0] if k + 1 < len(frames) else end_ts
        lines.append(f"file '{p}'\nduration {max(nxt - ts, 1/24):.4f}\n")
    lines.append(f"file '{os.path.join(d, f'{len(frames)-1:06d}.jpg')}'\n")
    lst = os.path.join(d, "list.txt")
    open(lst, "w").write("".join(lines))
    mp4 = os.path.join(OUT, name + ".mp4")
    subprocess.run([FF, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst,
                    "-vf", "fps=24,scale=1920:1080:flags=lanczos,format=yuv420p", "-r", "24",
                    "-c:v", "libx264", "-crf", "14", "-preset", "slow", mp4],
                   startupinfo=HIDDEN, creationflags=0x08000000, check=True)
    # Wall-clock span of the take, so render_audio.py can build the matching station audio.
    json.dump({"start_ms": int(frames[0][0] * 1000), "end_ms": int(end_ts * 1000), **tab.marks},
              open(os.path.join(OUT, name + ".json"), "w"))
    print(name, "->", mp4, len(frames), "frames")


def power_on(tab):
    tab.click("#power")
    time.sleep(0.8)
    tab.ev("document.getElementById('glass').focus()")


# ------------------------------------------------------------------ scenes
def tune_in(tab):
    open_site(tab, "localStorage.removeItem('deadair.logbook.v1')")
    record_start(tab)
    time.sleep(2.5)
    power_on(tab)
    time.sleep(1.5)
    tab.sweep(1714)
    tab.marks["lock_ms"] = int(time.time() * 1000)
    time.sleep(16)
    record_stop(tab, "tune_in")


def hidden(tab):
    open_site(tab, "localStorage.removeItem('deadair.logbook.v1')")
    power_on(tab)
    tab.sweep(1300, fast=0.002, slow=0.002)
    record_start(tab)
    time.sleep(1.5)
    tab.marks["sweep_ms"] = int(time.time() * 1000)
    tab.sweep(1410, fast=0.05, slow=0.12, slow_within=12)
    tab.marks["lock_ms"] = int(time.time() * 1000)
    time.sleep(9)
    record_stop(tab, "hidden")


def logbook(tab):
    pages = {p: {"at": int(time.time() * 1000) - 3_600_000, "freq": f}
             for p, f in [("old-station", 1410), ("marty", 870), ("between", 666)]}
    open_site(tab, "localStorage.setItem('deadair.logbook.v1', JSON.stringify(%s))" %
              json.dumps({"found": pages, "ads": ["ad_diner", "ad_rink"], "numbersHeard": True, "finaleDone": False}))
    record_start(tab)
    time.sleep(2)
    tab.click(".lb-open")
    time.sleep(7)
    tab.ev("document.querySelector('dialog.lb').scrollTo({top: 600, behavior: 'smooth'})")
    time.sleep(5)
    record_stop(tab, "logbook")


def request(tab):
    open_site(tab)
    record_start(tab)
    time.sleep(1.5)
    tab.click(".rq-open")
    time.sleep(2)
    tab.click(".rq input[autocomplete='given-name']")
    tab.type("Sam")
    tab.click(".rq-field:nth-of-type(2) input")
    tab.type("Dad")
    tab.click(".rq textarea")
    tab.type("Thanks for the late drives home with the radio on.", delay=0.05)
    tab.click(".rq input[placeholder]")
    tab.type("long drive")
    time.sleep(1.2)
    tab.click(".rq-song")
    time.sleep(3)
    record_stop(tab, "request")


def finale(tab):
    ebs = int(sys.argv[sys.argv.index("--ebs") + 1]) if "--ebs" in sys.argv else None
    if not ebs:
        print("finale needs --ebs <ms>")
        return
    found = {p: {"at": 0, "freq": 1} for p in
             ["old-station", "marty", "bulletin", "hold", "town", "three-fourteen", "rink", "between"]}
    inject = """(() => {
      const SHIFT = %d - Date.now();
      localStorage.setItem('deadair.logbook.v1', JSON.stringify({found: %s, ads: [], numbersHeard: true, finaleDone: false}));
      const real = window.fetch.bind(window);
      window.fetch = (u, o) => {
        if (typeof u === 'string' && u.startsWith('/now') && !u.includes('t=')) u = '/now?t=' + Math.round(Date.now() + SHIFT);
        return real(u, o);
      };
    })();""" % (ebs - 9000, json.dumps(found))
    open_site(tab, inject)
    power_on(tab)
    tab.sweep(1714, fast=0.001, slow=0.001)
    record_start(tab)
    time.sleep(28)
    tab.click(".lb-open")
    time.sleep(6)
    record_stop(tab, "finale")


def github_page(tab, url, scroll_px, hold=2.5, steps=60, step_s=0.05):
    """Navigate (the screencast keeps running across navigations), settle, then glide down."""
    tab.send("Page.navigate", {"url": url})
    time.sleep(3.5)
    tab.ev("document.documentElement.style.scrollBehavior='auto'")
    time.sleep(hold)
    for i in range(1, steps + 1):  # ease in and out, like a hand on a scroll wheel
        f = (1 - __import__("math").cos(3.14159 * i / steps)) / 2
        tab.ev(f"window.scrollTo(0, {int(scroll_px * f)})")
        time.sleep(step_s)
    time.sleep(hold)


def kiro(tab):
    """The Kiro side, on the public repo: specs, a spec's requirements, hooks, the MCP server."""
    base = "https://github.com/NoBanks/dead-air"
    tab.send("Page.enable")
    tab.send("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 720, "deviceScaleFactor": 1.5, "mobile": False})
    tab.send("Emulation.setScrollbarsHidden", {"hidden": True})
    tab.send("Emulation.setEmulatedMedia", {"features": [{"name": "prefers-color-scheme", "value": "dark"}]})
    tab.send("Page.navigate", {"url": base + "/tree/main/.kiro/specs"})
    time.sleep(5)
    urllib.request.urlopen("http://127.0.0.1:9333/json/activate/" + tab.info["id"])
    record_start(tab)
    time.sleep(3)
    github_page(tab, base + "/blob/main/.kiro/specs/the-hunt/requirements.md", 1400)
    github_page(tab, base + "/blob/main/.kiro/specs/broadcast-clock/design.md", 1800)
    github_page(tab, base + "/blob/main/.kiro/hooks/dead-air.json", 500)
    github_page(tab, base + "/blob/main/.kiro/steering/dead-john.md", 900)
    github_page(tab, base + "/blob/main/.kiro/settings/mcp.json", 0)
    record_stop(tab, "kiro")


def tests(tab):
    """Replay of the real vitest runs (tests_page.py builds tests.html from saved output)."""
    tab.send("Page.enable")
    tab.send("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 720, "deviceScaleFactor": 1.5, "mobile": False})
    tab.send("Emulation.setScrollbarsHidden", {"hidden": True})
    tab.send("Page.navigate", {"url": "about:blank"})
    time.sleep(1)
    urllib.request.urlopen("http://127.0.0.1:9333/json/activate/" + tab.info["id"])
    record_start(tab)
    tab.send("Page.navigate", {"url": "file:///" + os.path.join(OUT, "tests.html").replace("\\", "/")})
    time.sleep(16)
    record_stop(tab, "tests")


SCENES = {"tests": tests, "kiro": kiro, "tune_in": tune_in, "hidden": hidden, "logbook": logbook, "request": request, "finale": finale}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name in [a for a in sys.argv[1:] if a in SCENES]:
        tab = Tab()
        try:
            SCENES[name](tab)
        finally:
            tab.close()
