import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { prepareReadme } from "./readme.ts";

test("omits maintainer-only sections through the next level-two heading", () => {
  const result = prepareReadme(`# Tokmon

## Marketing site
private details
\`\`\`md
## A fenced example is not a section boundary
\`\`\`
### Nested
still private

## Providers
public details

## CI/CD
release internals

## License
MIT
`);

  assert.doesNotMatch(
    result,
    /# Tokmon|Marketing site|private details|Nested|CI\/CD|release internals/,
  );
  assert.match(result, /## Providers\npublic details/);
  assert.match(result, /## License\nMIT/);
});

test("rewrites repository-relative images and document links", () => {
  const result = prepareReadme(`![desktop](assets/desktop/tray-popover.png)
![dashboard](assets/web/overview.png)
[notices](THIRD_PARTY_NOTICES.md)
[license](./LICENSE "License")
`);

  assert.match(result, /!\[desktop\]\(\/tray-popover\.webp\)/);
  assert.match(
    result,
    /https:\/\/raw\.githubusercontent\.com\/DavidIlie\/tokmon\/master\/assets\/web\/overview\.png/,
  );
  assert.match(
    result,
    /https:\/\/github\.com\/DavidIlie\/tokmon\/blob\/master\/THIRD_PARTY_NOTICES\.md/,
  );
  assert.match(
    result,
    /https:\/\/github\.com\/DavidIlie\/tokmon\/blob\/master\/LICENSE "License"/,
  );
});

test("leaves external URLs, anchors, root paths, and fenced code untouched", () => {
  const input = `[site](https://example.com)
[mail](mailto:test@example.com)
[privacy](#privacy)
[home](/)
\`\`\`md
![example](local.png)
\`\`\`
`;

  assert.equal(prepareReadme(input), input);
});

test("the current repository README keeps public docs and omits maintainer sections", () => {
  const source = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
  const result = prepareReadme(source);

  assert.doesNotMatch(result, /^## (?:Marketing site|CI\/CD)$/m);
  assert.match(result, /^## Privacy$/m);
  assert.match(result, /^## How It Works$/m);
  assert.match(result, /!\[tokmon dashboard\]\(\/screenshot\.webp\)/);
  assert.match(result, /!\[Tokmon desktop quota popover\]\(\/tray-popover\.webp\)/);
  assert.match(
    result,
    /https:\/\/github\.com\/DavidIlie\/tokmon\/blob\/master\/THIRD_PARTY_NOTICES\.md/,
  );
});
