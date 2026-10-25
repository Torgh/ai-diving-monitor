import { describe, expect, it } from "vitest";
import { splitSections } from "./sections";

describe("splitSections", () => {
  it("splits at the main headings and keeps the subheadings inside", () => {
    const text = ["Dive 3, 39 m.", "", "## What went well", "- Slow ascent", "### Detail", "ok", "## What to watch ##", "1. Gas"].join("\n");
    expect(splitSections(text)).toEqual({
      intro: "Dive 3, 39 m.",
      sections: [
        { title: "What went well", body: "- Slow ascent\n### Detail\nok" },
        { title: "What to watch", body: "1. Gas" },
      ],
    });
  });

  it("ignores headings in code blocks", () => {
    const text = ["## A", "```", "## not a heading", "```", "## B", "b"].join("\r\n");
    expect(splitSections(text)?.sections.map((s) => s.title)).toEqual(["A", "B"]);
  });

  it("leaves short texts whole", () => {
    expect(splitSections("Just a line.")).toBeNull();
    expect(splitSections("## Only one\ntext")).toBeNull();
  });
});
