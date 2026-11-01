"""request-line T-6 (30 s cap), T-7 (Whisper check / drop), T-8 (airAt spacing).
Run: python -m unittest discover -s tools/studio/tests"""
import os, random, sys, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from worker import build_script, choose_take, assign_air_at, MIN_LEAD_MS, MIN_GAP_MS  # noqa: E402


def take(n, secs, match, ok=True):
    return {"take": n, "file": f"read_take{n}.wav", "secs": secs, "qa": {"ok": ok, "word_match": match}}


class TestWorker(unittest.TestCase):
    def test_t6_reads_longer_than_30s_are_never_used(self):
        self.assertIsNone(choose_take([take(1, 30.5, 1.0), take(2, 41, 0.99)]))
        self.assertEqual(choose_take([take(1, 30.5, 1.0), take(2, 29.9, 0.9)])["take"], 2)

    def test_t7_whisper_check(self):
        self.assertIsNone(choose_take([take(1, 12, 0.84), take(2, 12, 0.6)]))   # both misheard: drop
        self.assertIsNone(choose_take([take(1, 12, 0.99, ok=False)]))          # QA flagged it
        self.assertEqual(choose_take([take(1, 12, 0.86), take(2, 12, 0.95)])["take"], 2)

    def test_t8_air_times_are_ahead_and_spaced(self):
        rng = random.Random(7)
        for _ in range(500):
            now = rng.randint(0, 10**12)
            taken = sorted(now + rng.randint(-30, 120) * 60_000 for _ in range(rng.randint(0, 8)))
            t = assign_air_at(now, taken)
            self.assertGreaterEqual(t - now, MIN_LEAD_MS)
            for o in taken:
                self.assertGreaterEqual(abs(t - o), MIN_GAP_MS)

    def test_script_reads_like_dead_john(self):
        s = build_script({"from": "Ryan", "to": "Charlie", "message": "Feel better, buddy.", "songTitle": "Sleeper"})
        self.assertEqual(s, "Got a call on the request line. This one's from Ryan, for Charlie. Feel better, buddy. Here's Sleeper.")
        self.assertNotIn("—", s)


if __name__ == "__main__":
    unittest.main()
