import { describe, it, expect } from "vitest";
import {
  stationDayStart,
  stationDayEnd,
  stationHourOf,
  stationDayStartByIndex,
  stationDayIndex,
} from "../src/core/tzoffsets.js";

const EPOCH = new Date("2026-10-31T07:00:00Z").getTime();
const NOV1 = new Date("2026-11-01T07:00:00Z").getTime();  // midnight PDT -> PST
const MAR14 = new Date("2027-03-14T08:00:00Z").getTime(); // midnight PST -> PDT

describe("tzoffsets", () => {
  it("epoch day starts at 2026-10-31T07:00:00Z", () => {
    expect(stationDayStart(EPOCH)).toBe(EPOCH);
  });

  it("stationHourOf at LA midnight is 0", () => {
    expect(stationHourOf(EPOCH)).toBe(0);
    expect(stationHourOf(NOV1)).toBe(0);
    expect(stationHourOf(MAR14)).toBe(0);
  });

  it("epoch day is 24 h (Oct 31, PDT day, no DST transition)", () => {
    const s = stationDayStart(EPOCH);
    const e = stationDayEnd(s + 3_600_000);
    console.log(`Oct 31: ${new Date(s).toISOString()} → ${new Date(e).toISOString()} = ${(e - s) / 3_600_000}h`);
    expect((e - s) / 3_600_000).toBe(24);
  });

  it("Nov 1 2026 is 25 h (fall-back day)", () => {
    const s = stationDayStart(NOV1);
    const e = stationDayEnd(s + 3_600_000);
    console.log(`Nov 1: ${new Date(s).toISOString()} → ${new Date(e).toISOString()} = ${(e - s) / 3_600_000}h`);
    expect((e - s) / 3_600_000).toBe(25);
  });

  it("Mar 14 2027 is 23 h (spring-forward day)", () => {
    const s = stationDayStart(MAR14);
    const e = stationDayEnd(s + 3_600_000);
    console.log(`Mar 14: ${new Date(s).toISOString()} → ${new Date(e).toISOString()} = ${(e - s) / 3_600_000}h`);
    expect((e - s) / 3_600_000).toBe(23);
  });

  it("stationDayStartByIndex(1, epoch) === NOV1", () => {
    const s = stationDayStartByIndex(1, EPOCH);
    console.log(`Day index 1: ${new Date(s).toISOString()}`);
    expect(s).toBe(NOV1);
  });

  it("stationDayIndex(NOV1, epoch) === 1", () => {
    expect(stationDayIndex(NOV1, EPOCH)).toBe(1);
  });
});
