#!/usr/bin/env node
import fs from "fs";
import path from "path";

// Kiro passes the hook event as JSON on STDIN; a path argument also works for manual runs.
function findPath(obj) {
  if (!obj || typeof obj !== "object") return "";
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && /^(path|file_path|filePath|targetFile|file)$/.test(k)) return v;
    const nested = findPath(v);
    if (nested) return nested;
  }
  return "";
}

let filePath = process.argv[2];
if (!filePath && !process.stdin.isTTY) {
  try {
    filePath = findPath(JSON.parse(fs.readFileSync(0, "utf-8")));
  } catch (e) {
    filePath = "";
  }
}

if (!filePath) {
  console.error("File path required");
  process.exit(1);
}

let content;
try {
  content = fs.readFileSync(filePath, "utf-8");
} catch (e) {
  console.error(`Cannot read file: ${filePath}`);
  process.exit(1);
}

const lines = content.split("\n");
const violations = [];

const rules = [
  {
    name: "em-dash",
    pattern: /—|\\u2014/i,
    message: "no em dashes",
  },
  {
    name: "word-ai",
    pattern: /\b(AI|artificial|algorithm|generated|model)\b/i,
    message: "forbidden word (AI/artificial/algorithm/generated/model)",
  },
  {
    name: "alcohol",
    pattern: /\b(beer|wine|whiskey|vodka|drunk|booze|bar tab|cheers)\b/i,
    message: "alcohol reference",
  },
  {
    name: "nobanks-spelling",
    pattern: /nobanks\s+nearby/i,
    check: (match) => match === "NoBanks Nearby",
    message: "NoBanks Nearby must be spelled exactly",
  },
];

lines.forEach((line, index) => {
  const lineNum = index + 1;

  rules.forEach((rule) => {
    const match = line.match(rule.pattern);
    if (match) {
      if (rule.check && !rule.check(match[0])) {
        violations.push(`${filePath}:${lineNum}: ${rule.message}`);
      } else if (!rule.check) {
        violations.push(`${filePath}:${lineNum}: ${rule.message}`);
      }
    }
  });
});

if (violations.length > 0) {
  violations.forEach((v) => console.error(v));
  process.exit(1);
}

console.log("lint ok");
process.exit(0);
