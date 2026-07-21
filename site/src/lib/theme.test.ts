import assert from "node:assert/strict";
import { test } from "node:test";
import { IMPORTED_THEME_IDS } from "../../../src/theme/catalog.ts";
import {
  contrastRatio,
  DEFAULT_THEME_ID,
  SITE_THEMES,
  SITE_THEME_VARS,
  themeBootstrapData,
} from "./theme.ts";

test("the default marketing theme preserves the frozen Tokmon palette", () => {
  const tokmon = SITE_THEMES.find((theme) => theme.id === DEFAULT_THEME_ID)!;
  assert.deepEqual({
    bg0: tokmon.vars["--bg-0"], bg1: tokmon.vars["--bg-1"],
    bg2: tokmon.vars["--bg-2"], bg3: tokmon.vars["--bg-3"],
    line: tokmon.vars["--line"], line2: tokmon.vars["--line-2"],
    fg: tokmon.vars["--fg"], dim: tokmon.vars["--fg-dim"],
    faint: tokmon.vars["--fg-faint"], bright: tokmon.vars["--fg-bright"],
    accent: tokmon.vars["--accent"], cost: tokmon.vars["--cost"],
  }, {
    bg0: "#0a0a0a", bg1: "#101011", bg2: "#161617", bg3: "#1d1d1e",
    line: "#262627", line2: "#343435", fg: "#d4d6d6", dim: "#8d9090",
    faint: "#585b5b", bright: "#f3f5f5", accent: "#79be7e", cost: "#d9c074",
  });
});

test("the site consumes the complete shared editor-theme catalog", () => {
  assert.deepEqual(SITE_THEMES.map((theme) => theme.id), ["tokmon", "phosphor", ...IMPORTED_THEME_IDS]);
});

test("every preview palette meets its semantic text contrast contract", () => {
  for (const theme of SITE_THEMES) {
    const v = theme.vars;
    for (const background of [v["--bg-0"], v["--bg-1"]]) {
      assert.ok(contrastRatio(v["--fg"], background) >= 4.5, `${theme.id} body text`);
      assert.ok(contrastRatio(v["--fg-bright"], background) >= 4.5, `${theme.id} strong text`);
      assert.ok(contrastRatio(v["--accent-text"], background) >= 4.5, `${theme.id} accent text`);
      assert.ok(contrastRatio(v["--accent"], background) >= 3, `${theme.id} accent UI`);
    }
    assert.ok(contrastRatio(v["--code-fg"], v["--bg-2"]) >= 4.5, `${theme.id} code text`);
    assert.ok(contrastRatio(v["--accent-on"], v["--accent"]) >= 4.5, `${theme.id} accent fill text`);
  }
});

test("the first-paint table is compact, complete, and CSS-safe", () => {
  const data = themeBootstrapData();
  assert.equal(data.defaultId, "tokmon");
  assert.deepEqual(Object.keys(data.table), SITE_THEMES.map((theme) => theme.id));
  for (const row of Object.values(data.table)) {
    assert.equal(row.length, SITE_THEME_VARS.length);
    assert.ok(row.every((value) => /^#[0-9a-f]{6}$/i.test(value)));
  }
  assert.ok(Object.values(data.schemes).every((scheme) => scheme === "dark"));
});
