"""Turn real vitest output into a terminal-style replay page for the video (no console window ever opens).
Keeps only the real result lines; nothing is invented."""
import html, json, os, re

D = os.path.join(os.path.expanduser("~"), ".deadair", "demo")
ANSI = re.compile(r"\x1b\[[0-9;]*m")


def lines(name):
    out = []
    for raw in open(os.path.join(D, name), encoding="utf-8-sig", errors="replace"):
        s = ANSI.sub("", raw.rstrip())
        if re.search(r"(✓|×|Test Files|Tests\s+\d)", s):
            out.append(re.sub(r"\s+\d+ms$", "", s.strip()))
    return out


station = lines("station_tests.txt")
web = lines("web_tests.txt")
script = (["$ cd station && npx vitest run"] + station + [""] +
          ["$ cd web && npx vitest run"] + web)
page = """<!doctype html><meta charset="utf-8"><title>tests</title>
<style>
body{margin:0;background:#0b0c0d;color:#cfd6cf;font:17px/1.55 Consolas,"Cascadia Mono",monospace}
#t{padding:34px 46px;white-space:pre}
.cmd{color:#ff9a4a}.ok{color:#7bd88f}.sum{color:#fff;font-weight:bold}
</style><div id="t"></div><script>
const L=%s;const t=document.getElementById('t');let i=0;
function cls(s){return s.startsWith('$')?'cmd':/Tests|Test Files/.test(s)?'sum':s.includes('\\u2713')?'ok':''}
function next(){if(i>=L.length)return;const d=document.createElement('div');d.className=cls(L[i]);d.textContent=L[i]||' ';
t.appendChild(d);window.scrollTo(0,document.body.scrollHeight);const s=L[i];i++;
setTimeout(next,s.startsWith('$')?900:/Tests/.test(s)?700:55)}
setTimeout(next,800);
</script>""" % json.dumps(script)
open(os.path.join(D, "tests.html"), "w", encoding="utf-8").write(page)
print(len(script), "lines")
