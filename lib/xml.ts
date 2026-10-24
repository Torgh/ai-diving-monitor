import { XMLParser, XMLValidator } from "fast-xml-parser";

/**
 * A small element tree over fast-xml-parser, with the parts of Python's ElementTree the UDDF parser
 * uses, so the port reads files the same way. Namespace prefixes are removed from tag names, and
 * text is trimmed.
 */
export interface XmlElement {
  tag: string;
  attrs: Record<string, string>;
  /** Text before the first child element (ElementTree's `.text`), or null. */
  text: string | null;
  children: XmlElement[];
  /** Every text piece inside the element, in document order (ElementTree's `itertext()`). */
  texts: string[];
}

export class XmlError extends Error {}

type Node = Record<string, unknown> & { ":@"?: Record<string, string> };

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: true,
  trimValues: true,
});

function build(node: Node): XmlElement | null {
  const tag = Object.keys(node).find((k) => k !== ":@");
  if (!tag || tag === "#text" || tag.startsWith("?")) return null;
  const element: XmlElement = { tag, attrs: { ...(node[":@"] ?? {}) }, text: null, children: [], texts: [] };
  for (const child of node[tag] as Node[]) {
    if ("#text" in child) {
      const text = String(child["#text"]);
      if (!text) continue;
      element.texts.push(text);
      if (element.children.length === 0) element.text = (element.text ?? "") + text;
      continue;
    }
    const sub = build(child);
    if (sub) {
      element.children.push(sub);
      element.texts.push(...sub.texts);
    }
  }
  return element;
}

/** The root element of an XML document. Throws XmlError when the text isn't well-formed XML. */
export function parseXml(text: string): XmlElement {
  const valid = XMLValidator.validate(text);
  if (valid !== true) throw new XmlError(`${valid.err.msg} (line ${valid.err.line}, column ${valid.err.col})`);
  const roots = (parser.parse(text) as Node[]).map(build).filter((e): e is XmlElement => e !== null);
  if (roots.length !== 1) throw new XmlError("Expected exactly one root element");
  return roots[0];
}

/** The first element at a slash-separated path of child tags, like ElementTree's `find`. */
export function find(element: XmlElement | null | undefined, path: string): XmlElement | null {
  let current: XmlElement | null = element ?? null;
  for (const tag of path.replace(/^\.\//, "").split("/")) {
    if (!current) return null;
    current = current.children.find((c) => c.tag === tag) ?? null;
  }
  return current;
}

/** All direct children with this tag, like ElementTree's `findall`. */
export function findAll(element: XmlElement | null | undefined, tag: string): XmlElement[] {
  return element ? element.children.filter((c) => c.tag === tag) : [];
}

/** ElementTree's `findtext`: the element's text, "" when it has none, null when it is missing. */
export function findText(element: XmlElement | null | undefined, path: string): string | null {
  const found = find(element, path);
  return found ? (found.text ?? "") : null;
}

/** The element and all its descendants with this tag, in document order, like ElementTree's `iter`. */
export function* iter(element: XmlElement, tag: string): Generator<XmlElement> {
  if (element.tag === tag) yield element;
  for (const child of element.children) yield* iter(child, tag);
}
