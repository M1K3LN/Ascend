import { describe, expect, it } from "vitest";
import { parseAmbassadorCsv, parseCsv } from "./csv.js";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas and CRLF", () => {
    const rows = parseCsv('a,"b,c","say ""hi"""\r\nd,e,f\n');
    expect(rows).toEqual([
      ["a", "b,c", 'say "hi"'],
      ["d", "e", "f"],
    ]);
  });
});

describe("parseAmbassadorCsv", () => {
  it("parses rows, dedupes by email, and reports errors", () => {
    const csv = [
      "Name,Email,Tier,Tags",
      "Jane Doe,jane@example.com,gold,fitness;yoga",
      "John Roe,JANE@example.com,silver,", // dupe (case-insensitive)
      "Bad Row,not-an-email,,",
      "Amy Poe,amy@example.com,,running",
    ].join("\n");

    const parsed = parseAmbassadorCsv(csv);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({ name: "Jane Doe", email: "jane@example.com", tier: "gold", tags: ["fitness", "yoga"] });
    expect(parsed.duplicateEmailsInFile).toBe(1);
    expect(parsed.errors).toEqual([{ line: 4, reason: "invalid email: not-an-email" }]);
  });

  it("supports first_name/last_name and requires an email column", () => {
    const parsed = parseAmbassadorCsv("first_name,last_name,email\nJane,Doe,jane@x.co");
    expect(parsed.rows[0].name).toBe("Jane Doe");

    const missing = parseAmbassadorCsv("name,tier\nJane,gold");
    expect(missing.rows).toHaveLength(0);
    expect(missing.errors[0].reason).toMatch(/email/);
  });
});
