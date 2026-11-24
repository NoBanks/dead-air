#!/usr/bin/env node
import { execSync } from "child_process";

let passed = 0;
let failed = 0;
const errors = [];

function runTest(label, command, cwd = ".") {
  try {
    execSync(command, {
      cwd,
      stdio: "pipe",
      windowsHide: true,
    });
    passed++;
    console.error(`✓ ${label}`);
  } catch (e) {
    failed++;
    errors.push(`✗ ${label}`);
    console.error(`✗ ${label}`);
  }
}

runTest("tools/library tests", "npm --prefix tools/library test");
runTest("station tests", "npm --prefix station test -- --run");
runTest("web tests", "npm --prefix web test");
runTest("tools/library typecheck", "npx tsc --noEmit", "tools/library");
runTest("station typecheck", "npx tsc --noEmit", "station");
runTest("web typecheck", "npx tsc --noEmit", "web");

const summary =
  failed === 0
    ? `✓ all tests pass (${passed}/${passed + failed})`
    : `✗ ${failed} failed (${passed}/${passed + failed})`;

console.error(summary);
process.exit(failed === 0 ? 0 : 1);
