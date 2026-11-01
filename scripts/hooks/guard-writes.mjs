#!/usr/bin/env node
import fs from "fs";

let stdin = "";
process.stdin.setEncoding("utf-8");

process.stdin.on("data", (chunk) => {
  stdin += chunk;
});

process.stdin.on("end", () => {
  let toolCall;
  try {
    toolCall = JSON.parse(stdin);
  } catch (e) {
    console.error("Invalid JSON from stdin");
    process.exit(1);
  }

  // The event shape differs between Kiro surfaces, so look for the path field anywhere in it.
  const findPath = (obj) => {
    if (!obj || typeof obj !== "object") return "";
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && /^(path|file_path|filePath|targetFile|file)$/.test(k)) return v;
      const nested = findPath(v);
      if (nested) return nested;
    }
    return "";
  };
  const targetPath = findPath(toolCall);

  const blockedExtensions = [".wav", ".mp3", ".flac"];
  const envMatch = /\.env(\..*)?$/.test(targetPath);
  const isBlockedFile =
    blockedExtensions.some((ext) => targetPath.toLowerCase().endsWith(ext)) ||
    envMatch;

  if (isBlockedFile) {
    const reason = envMatch
      ? "secrets (.env files) must not be committed to the repo"
      : "audio files must not be committed to the repo";

    console.error(`Blocked: ${reason} (${targetPath})`);
    process.exit(2);
  }

  process.exit(0);
});
