# Third-party notices — Tokmon marketing site

This directory (`site/`) is the Tokmon marketing site. It reuses a small amount
of third-party material, noted here so it can be merged into the repository-root
`THIRD_PARTY_NOTICES.md`.

## Provider vector marks — OpenUsage (MIT)

The monochrome, single-path provider marks rendered in the provider grid
(`src/lib/site.ts` → `PROVIDER_MARKS`, drawn by `src/components/ProviderMark.astro`)
are structurally adapted from **OpenUsage by Robin Ebers**
(https://github.com/robinebers/openusage), used under the MIT License. They are
the same marks the Tokmon desktop app ships in
`src/desktop/renderer/provider-icons.ts`. Brand fills are dropped; each mark
inherits `currentColor`. pi and Gemini use a computed monogram, not third-party
artwork.

```
MIT License

Copyright (c) OpenUsage contributors (Robin Ebers)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fonts

- **JetBrains Mono** (`public/fonts/JetBrainsMono-*.woff2`, body/UI type) is
  self-hosted from the app's `@fontsource/jetbrains-mono` dependency and is
  licensed under the SIL Open Font License 1.1.
- **Departure Mono** (`public/fonts/DepartureMono-Regular.woff2`, the wordmark /
  display face) is bundled from the Tokmon web app assets
  (`web/src/assets/fonts/`) and is licensed under the SIL Open Font License 1.1.

The copyright notices and complete license text for both families are bundled
next to the font files in `public/fonts/OFL.txt`.

## Marketing site structure — T3 Code (MIT)

The site's page structure and interaction grammar substantially adapt the T3
Code marketing site (`apps/marketing`). Tokmon uses its own copy, imagery,
provider data, release logic, and visual theme. T3 Code is used under the MIT
License:

```
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
