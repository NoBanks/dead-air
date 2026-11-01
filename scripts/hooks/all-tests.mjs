#!/usr/bin/env node
import { execSync } from "child_process";

let passed = 0;
let failed = 0;
const errors = [];

function runTest(label, command) {
  try {
    execSync(command, {
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

runTest("tools/library tests", "npm --prefix tools/library test -- --run");
runTest("station tests", "npm --prefix station test -- --run");
runTest("tools/library tsc", "npm --prefix tools/library run tsc");
runTest("station tsc", "npm --prefix station run tsc");

const summary =
  failed === 0
    ? `✓ all tests pass (${passed}/${passed + failed})`
    : `✗ ${failed} failed (${passed}/${passed + failed})`;

console.error(summary);
process.exit(failed === 0 ? 0 : 1);
