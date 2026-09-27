import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Resource, ResourceRepository } from "../src/domain/resource";
import { createFsCacheAdapter } from "../src/infrastructure/adapters/fs-cache-adapter";
import { tmpDir } from "./helpers";

function setup() {
  const stored = new Map<string, Resource>();
  const repo: ResourceRepository = {
    findByResourceId: async (id) => stored.get(id) ?? null,
    save: async (r) => void stored.set(r.resourceId, r),
  };
  const contentDir = tmpDir("kv-content-");
  return { adapter: createFsCacheAdapter({ contentDir, resource: repo }), contentDir, stored };
}

describe("fs-cache-adapter as an archive", () => {
  test("save copies the file to content/mp3, findFile returns it with its resource", async () => {
    const { adapter, contentDir } = setup();
    const source = join(tmpDir(), "in.mp3");
    writeFileSync(source, "audio-bytes");
    const resource: Resource = { resourceId: "abc", url: "http://x", title: "A/B: mix?", duration: 5 };

    await adapter.save(resource, source, 1);
    const found = await adapter.findFile("abc");

    expect(found?.resource).toEqual(resource);
    expect(found?.filePath.startsWith(join(contentDir, "mp3"))).toBe(true);
    expect(found?.filePath.endsWith("_abc.mp3")).toBe(true);
    expect(readFileSync(found!.filePath, "utf8")).toBe("audio-bytes");
    expect(existsSync(source)).toBe(true); // the archive copies, it never takes ownership
  });

  test("unknown resource -> null; a file without its resource row -> null", async () => {
    const { adapter, stored } = setup();
    expect(await adapter.findFile("nope")).toBeNull();

    const source = join(tmpDir(), "in.mp3");
    writeFileSync(source, "x");
    await adapter.save({ resourceId: "r", url: "u", title: "t", duration: 1 }, source, 1);
    stored.clear(); // metadata lost, file still on disk
    expect(await adapter.findFile("r")).toBeNull();
  });

  test("find is the resource part of findFile", async () => {
    const { adapter } = setup();
    const source = join(tmpDir(), "in.mp4");
    writeFileSync(source, "video");
    const resource: Resource = { resourceId: "v1", url: "u", title: "clip", duration: 9 };
    await adapter.save(resource, source, 1);

    expect(await adapter.find("v1")).toEqual(resource);
    expect((await adapter.findFile("v1"))?.filePath.endsWith("_v1.mp4")).toBe(true);
  });
});
