import { describe, expect, it } from "vitest";

import { parseCollectedAt } from "../src/normalize/collected-at.js";
import { parseBrazilianDecimal } from "../src/normalize/decimal.js";

describe("parseBrazilianDecimal", () => {
  it.each([
    ["2,4", 2.4],
    ["14,2", 14.2],
    ["0,85", 0.85],
    ["100", 100],
    ["1.234,5", 1234.5],
    ["-12,3", -12.3],
    ["0", 0],
    ["0,0", 0],
  ])("parses %s → %s", (input, expected) => {
    expect(parseBrazilianDecimal(input)).toBe(expected);
  });

  it.each([
    [""],
    ["abc"],
    ["12,3,4"],
    ["12.3.4"],
    ["12,"],
    [","],
    ["12 ,3"],
    ["NaN"],
  ])("returns null for unparseable %s", (input) => {
    expect(parseBrazilianDecimal(input)).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(parseBrazilianDecimal("  2,4  ")).toBe(2.4);
  });
});

describe("parseCollectedAt", () => {
  it("parses dd/mm/yyyy", () => {
    const d = parseCollectedAt("15/03/2024");
    expect(d?.toISOString().slice(0, 10)).toBe("2024-03-15");
  });

  it("parses dd-mm-yyyy", () => {
    const d = parseCollectedAt("15-03-2024");
    expect(d?.toISOString().slice(0, 10)).toBe("2024-03-15");
  });

  it("parses ISO yyyy-mm-dd", () => {
    const d = parseCollectedAt("2024-03-15");
    expect(d?.toISOString().slice(0, 10)).toBe("2024-03-15");
  });

  it.each([
    ["31/02/2024"], // Feb 31
    ["32/01/2024"], // day 32
    ["00/01/2024"], // day 0
    ["15/13/2024"], // month 13
    ["abc"],
    [""],
    ["2024/03/15"], // wrong order
  ])("returns null for %s", (input) => {
    expect(parseCollectedAt(input)).toBeNull();
  });

  it("rejects years outside [1900, 2100]", () => {
    expect(parseCollectedAt("01/01/1899")).toBeNull();
    expect(parseCollectedAt("01/01/2101")).toBeNull();
  });
});
