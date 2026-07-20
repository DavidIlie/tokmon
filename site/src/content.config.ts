import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineCollection } from "astro:content";
import type { Loader, LoaderContext } from "astro/loaders";
import { prepareReadme } from "./lib/readme.ts";

const readmePath = fileURLToPath(new URL("../../README.md", import.meta.url));
const readmeFile = "../README.md";

async function loadReadme(context: LoaderContext): Promise<void> {
  const source = await readFile(readmePath, "utf8");
  const body = prepareReadme(source);
  const rendered = await context.renderMarkdown(body);
  rendered.html = rendered.html.replace(
    /<img /g,
    '<img loading="lazy" decoding="async" ',
  );
  const data = await context.parseData({
    id: "readme",
    data: {},
    filePath: readmeFile,
  });

  context.store.clear();
  context.store.set({
    id: "readme",
    data,
    body,
    filePath: readmeFile,
    digest: context.generateDigest(source),
    rendered,
  });
}

const readmeLoader: Loader = {
  name: "tokmon-readme",
  async load(context) {
    await loadReadme(context);
    context.watcher?.add(readmePath);
    context.watcher?.on("change", (path) => {
      if (path === readmePath) void loadReadme(context);
    });
  },
};

export const collections = {
  docs: defineCollection({ loader: readmeLoader }),
};
