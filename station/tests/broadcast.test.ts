import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import http from "http";
import type { AddressInfo } from "net";
import express from "express";

// No real ffmpeg here: spawn() hands back a fake encoder process.
class FakeEncoder extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { writable: true, writableLength: 0, write: vi.fn(), end: vi.fn() };
  kill = vi.fn();
}
const spawned: FakeEncoder[] = [];
vi.mock("child_process", () => ({
  spawn: vi.fn(() => {
    const enc = new FakeEncoder();
    spawned.push(enc);
    return enc;
  }),
}));

import { Broadcast } from "../src/broadcast.js";

const BYTES_PER_MS = (44100 * 4) / 1000;
const LEAD_MS = 1500;
const MAX_CLIENT_BACKLOG = 2_000_000;

function fakeRes(writableLength = 0) {
  const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
  res.writeHead = vi.fn();
  res.write = vi.fn();
  res.destroy = vi.fn();
  res.writableLength = writableLength;
  return res;
}

function makeBroadcast(now: () => number) {
  return new Broadcast({
    ffmpeg: "ffmpeg-not-used",
    segments: () => [],
    localFile: (u) => u,
    clipSeconds: () => 0,
    now,
  });
}

describe("Broadcast (unit)", () => {
  let clock = 1_000_000;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    spawned.length = 0;
    clock = 1_000_000;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("tick() writes silence on PCM underrun and keeps feeding the encoder", () => {
    const b = makeBroadcast(() => clock);
    b.attach(fakeRes() as never);
    const enc = spawned[0];
    clock += LEAD_MS + 100; // 100 ms of mix is due, nothing decoded
    vi.advanceTimersByTime(50);
    expect(enc.stdin.write).toHaveBeenCalledTimes(1);
    const first = enc.stdin.write.mock.calls[0][0] as Buffer;
    expect(first.length).toBe(Math.floor((100 * BYTES_PER_MS) / 4) * 4);
    expect(first.every((x) => x === 0)).toBe(true);
    clock += 50; // the clock keeps moving, so does the feed
    vi.advanceTimersByTime(50);
    expect(enc.stdin.write).toHaveBeenCalledTimes(2);
  });

  it("attach() sends the burst to a new client and adds it to clients", () => {
    const b = makeBroadcast(() => clock);
    b.attach(fakeRes() as never);
    spawned[0].stdout.emit("data", Buffer.from("mp3-one"));
    spawned[0].stdout.emit("data", Buffer.from("mp3-two"));
    const late = fakeRes();
    b.attach(late as never);
    expect(late.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "audio/mpeg" }));
    expect((late.write as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))).toEqual(["mp3-one", "mp3-two"]);
    expect(b.listeners()).toBe(2);
  });

  it("broadcast() drops a client whose backlog is over the cap", () => {
    const b = makeBroadcast(() => clock);
    const slow = fakeRes(MAX_CLIENT_BACKLOG + 1);
    const ok = fakeRes();
    b.attach(slow as never);
    b.attach(ok as never);
    spawned[0].stdout.emit("data", Buffer.from("chunk"));
    expect(slow.destroy).toHaveBeenCalled();
    expect(slow.write).not.toHaveBeenCalled();
    expect(ok.write).toHaveBeenCalledWith(Buffer.from("chunk"));
    expect(b.listeners()).toBe(1);
  });

  it("stop() cancels the idle timer so it cannot stop the next session", () => {
    const b = makeBroadcast(() => clock);
    const first = fakeRes();
    b.attach(first as never);
    first.emit("close"); // last listener leaves: 60 s idle timer armed
    spawned[0].emit("exit"); // encoder dies, stop() runs, nobody to restart for
    expect(b.stats().running).toBe(false);
    b.attach(fakeRes() as never); // new session
    expect(spawned).toHaveLength(2);
    vi.advanceTimersByTime(61_000);
    expect(b.stats().running).toBe(true);
    expect(spawned[1].kill).not.toHaveBeenCalled();
  });
});

describe("GET /stream (smoke, in-process, stubbed encoder)", () => {
  // ffmpeg and real songs are not needed: the encoder is the fake above, so this runs everywhere.
  it("answers 200 audio/mpeg with a non-empty body", async () => {
    spawned.length = 0;
    const b = makeBroadcast(Date.now);
    const app = express();
    app.get("/stream", (_req, res) => b.attach(res));
    const server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const got = await new Promise<{ status?: number; type?: string; bytes: number }>((resolve, reject) => {
        const req = http.get({ port, path: "/stream", host: "127.0.0.1" }, (res) => {
          let bytes = 0;
          res.on("data", (c: Buffer) => {
            bytes += c.length;
            resolve({ status: res.statusCode, type: res.headers["content-type"], bytes });
            req.destroy();
          });
        });
        req.on("error", (e) => (e as NodeJS.ErrnoException).code === "ECONNRESET" ? undefined : reject(e));
        setTimeout(() => spawned[0]?.stdout.emit("data", Buffer.from("ID3-fake-mp3-bytes")), 50);
        setTimeout(() => reject(new Error("no body within 3 s")), 3000);
      });
      expect(got.status).toBe(200);
      expect(got.type).toBe("audio/mpeg");
      expect(got.bytes).toBeGreaterThan(0);
    } finally {
      for (let i = 0; i < 40 && b.listeners() > 0; i++) await new Promise((r) => setTimeout(r, 25)); // server sees the client leave
      spawned[0]?.emit("exit"); // stop() the pump and idle timer, no restart with nobody listening
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
