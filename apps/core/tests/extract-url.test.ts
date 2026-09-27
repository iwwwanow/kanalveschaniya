import { describe, expect, test } from "bun:test";
import { MAX_URLS_PER_MESSAGE, extractUrls } from "../src/infrastructure/presentation/extract-url";

describe("extractUrls", () => {
  test("a bare link", () => {
    expect(extractUrls("https://soundcloud.com/a/b")).toEqual(["https://soundcloud.com/a/b"]);
    expect(extractUrls("  https://youtu.be/xyz \n")).toEqual(["https://youtu.be/xyz"]);
  });

  test("a link inside text, with sentence punctuation glued to it", () => {
    expect(extractUrls("вот трек https://youtu.be/xyz, глянь")).toEqual(["https://youtu.be/xyz"]);
    expect(extractUrls("Слушай (https://youtu.be/xyz).")).toEqual(["https://youtu.be/xyz"]);
    expect(extractUrls("круто! https://youtu.be/xyz?!")).toEqual(["https://youtu.be/xyz"]);
  });

  test("keeps a closing bracket that belongs to the link", () => {
    expect(extractUrls("https://en.wikipedia.org/wiki/Foo_(bar)")).toEqual(["https://en.wikipedia.org/wiki/Foo_(bar)"]);
  });

  test("several links: in order, deduplicated", () => {
    expect(extractUrls("https://a.com/1 и https://b.com/2\nhttps://a.com/1")).toEqual(["https://a.com/1", "https://b.com/2"]);
  });

  test("no links, or other schemes -> empty", () => {
    expect(extractUrls("просто текст")).toEqual([]);
    expect(extractUrls("ftp://x.com/a mailto:a@b.c")).toEqual([]);
    expect(extractUrls("")).toEqual([]);
  });

  test("caps the number of links per message", () => {
    const text = Array.from({ length: MAX_URLS_PER_MESSAGE + 5 }, (_, i) => `https://x.com/${i}`).join(" ");
    expect(extractUrls(text)).toHaveLength(MAX_URLS_PER_MESSAGE);
  });
});
