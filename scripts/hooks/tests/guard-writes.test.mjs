import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const guardScriptPath = path.join(__dirname, "..", "guard-writes.mjs");

function runGuardTest(input) {
  const result = spawnSync("node", [guardScriptPath], {
    input: JSON.stringify(input),
    encoding: "utf-8",
    windowsHide: true,
    cwd: path.join(__dirname, ".."),
  });
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("allow regular TypeScript files", () => {
  const result = runGuardTest({ arguments: { path: "src/index.ts" } });
  assert.strictEqual(result.exitCode, 0);
});

test("allow regular JSON files", () => {
  const result = runGuardTest({ arguments: { path: "data/library.json" } });
  assert.strictEqual(result.exitCode, 0);
});

test("block .wav files", () => {
  const result = runGuardTest({ arguments: { path: "audio/track.wav" } });
  assert.strictEqual(result.exitCode, 2);
  assert.match(result.stderr, /audio files/i);
});

test("block .mp3 files", () => {
  const result = runGuardTest({ arguments: { path: "audio/track.mp3" } });
  assert.strictEqual(result.exitCode, 2);
  assert.match(result.stderr, /audio files/i);
});

test("block .flac files", () => {
  const result = runGuardTest({ arguments: { path: "audio/track.flac" } });
  assert.strictEqual(result.exitCode, 2);
  assert.match(result.stderr, /audio files/i);
});

test("block .env anywhere in repo", () => {
  const result = runGuardTest({ arguments: { path: ".env" } });
  assert.strictEqual(result.exitCode, 2);
  assert.match(result.stderr, /secrets/i);
});

test("block .env in nested directory", () => {
  const result = runGuardTest({ arguments: { path: "config/.env.local" } });
  assert.strictEqual(result.exitCode, 2);
  assert.match(result.stderr, /secrets/i);
});

test("case insensitive for audio extensions", () => {
  const result = runGuardTest({ arguments: { path: "audio/track.WAV" } });
  assert.strictEqual(result.exitCode, 2);
});
