/**
 * csv.ts - Parse the source CSV, validate required columns, return SourceTrack[].
 *
 * REQ-1: One authoritative source of truth. Rows missing title or file are
 * skipped with a warning; CSV absence causes immediate exit.
 */

import { readFileSync } from "fs";
import { parse } from "csv-parse/sync";
import type { CsvRow, SourceTrack } from "./types.js";

/**
 * Parse the CSV at `csvPath` and return validated `SourceTrack[]`.
 *
 * Missing-column rows are logged to stderr and skipped.
 * If the file cannot be read the function throws, and the caller (index.ts)
 * handles the exit.
 *
 * @param csvPath - Absolute path to the CSV file.
 * @returns Array of validated source tracks.
 */
export function parseCsv(csvPath: string): SourceTrack[] {
  let raw: Buffer;
  try {
    raw = readFileSync(csvPath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read CSV file: ${msg}`);
  }

  let rows: CsvRow[];
  try {
    rows = parse(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as CsvRow[];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot parse CSV: ${msg}`);
  }

  const tracks: SourceTrack[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    if (!row.title || String(row.title).trim() === "") {
      process.stderr.write(
        `[csv] WARNING: row ${rowNum} missing "title" column — skipped\n`
      );
      continue;
    }

    if (!row.file || String(row.file).trim() === "") {
      process.stderr.write(
        `[csv] WARNING: row ${rowNum} ("${row.title}") missing "file" column — skipped\n`
      );
      continue;
    }

    const title = String(row.title).trim();
    const file = String(row.file).trim();
    const seconds = row.seconds !== undefined ? Number(row.seconds) : 0;
    const mstr =
      row.mstr !== undefined
        ? String(row.mstr).toLowerCase() === "true" ||
          row.mstr === true ||
          row.mstr === "1"
        : true;
    const ext = row.ext !== undefined ? String(row.ext).trim() : "wav";
    const versions = row.versions !== undefined ? Number(row.versions) : 1;
    const fileSizeMb =
      row.file_size_mb !== undefined ? Number(row.file_size_mb) : 0;

    tracks.push({ title, file, seconds, mstr, ext, versions, fileSizeMb });
  }

  return tracks;
}
