import { REPO_SLUG } from "./site.ts";

const RAW_ROOT = `https://raw.githubusercontent.com/${REPO_SLUG}/master`;
const BLOB_ROOT = `https://github.com/${REPO_SLUG}/blob/master`;
const OMITTED_SECTIONS = new Set(["marketing-site", "cicd"]);
const PUBLIC_IMAGES = new Map([
  ["screenshot.png", "/screenshot.webp"],
  ["assets/desktop/tray-popover.png", "/tray-popover.webp"],
]);

function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function isExternalTarget(target: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(target);
}

function rewriteTarget(target: string, image: boolean): string {
  const trimmed = target.trim();
  if (!trimmed || isExternalTarget(trimmed)) return target;

  const match = /^(\S+)(\s+.+)?$/.exec(trimmed);
  if (!match) return target;
  const path = match[1]!.replace(/^\.\//, "");
  const publicImage = image ? PUBLIC_IMAGES.get(path) : undefined;
  if (publicImage) return `${publicImage}${match[2] ?? ""}`;
  return `${image ? RAW_ROOT : BLOB_ROOT}/${path}${match[2] ?? ""}`;
}

/** Prepare the repository README for the public, build-time documentation page. */
export function prepareReadme(source: string): string {
  const output: string[] = [];
  let omitted = false;
  let fenced = false;
  let titleRemoved = false;

  for (const line of source.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;

    if (!fenced && !titleRemoved && /^#\s+/.test(line)) {
      titleRemoved = true;
      continue;
    }

    const levelTwo = /^##\s+(.+?)\s*$/.exec(line);
    if (!fenced && levelTwo) {
      omitted = OMITTED_SECTIONS.has(headingSlug(levelTwo[1]!));
    }
    if (omitted) continue;
    if (fenced) {
      output.push(line);
      continue;
    }

    output.push(
      line.replace(/(!?)\[([^\]]*)\]\(([^)]+)\)/g, (_all, bang, label, target) => {
        const rewritten = rewriteTarget(target, bang === "!");
        return `${bang}[${label}](${rewritten})`;
      }),
    );
  }

  return output.join("\n").trimEnd() + "\n";
}
