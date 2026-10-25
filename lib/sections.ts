/**
 * A long Markdown text (a debrief) split at its main headings, so a page can fold each part. The main
 * level is the highest one used (## when the text has no #); a heading inside a code block doesn't
 * count. Fewer than two headings: nothing worth folding, so null.
 */

export interface Section {
  title: string;
  body: string;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export function splitSections(markdown: string): { intro: string; sections: Section[] } | null {
  const lines = markdown.split(/\r?\n/);
  let fenced = false;
  const headings: { line: number; level: number; title: string }[] = [];
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const match = !fenced && HEADING.exec(line);
    if (match) headings.push({ line: i, level: match[1].length, title: match[2] });
  });
  if (!headings.length) return null;
  const level = Math.min(...headings.map((h) => h.level));
  const main = headings.filter((h) => h.level === level);
  if (main.length < 2) return null;
  return {
    intro: lines.slice(0, main[0].line).join("\n").trim(),
    sections: main.map((h, i) => ({
      title: h.title,
      body: lines
        .slice(h.line + 1, i + 1 < main.length ? main[i + 1].line : lines.length)
        .join("\n")
        .trim(),
    })),
  };
}
