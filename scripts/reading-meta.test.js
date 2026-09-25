import assert from "node:assert/strict";
import test from "node:test";
import {
  countCharacters,
  formatCount,
  readingMinutes,
  showUpdatedDate,
} from "../astro/src/lib/reading-meta.ts";

test("counts readable characters and ignores markup", () => {
  const source = [
    "## 标题",
    "你好 **世界**",
    "看 [链接](https://example.com) 和 ![图](cover.png)",
    "```js",
    "const n = 1;",
    "```",
  ].join("\n");
  assert.equal(countCharacters(source), "标题你好世界看链接和constn=1;".length);
});

test("estimates at least one minute and rounds up past 400 characters", () => {
  assert.equal(readingMinutes(0), 1);
  assert.equal(readingMinutes(400), 1);
  assert.equal(readingMinutes(401), 2);
});

test("formats thousands and shows an update only on a later day", () => {
  assert.equal(formatCount(1234), "1,234");
  const published = new Date("2026-06-11T13:08:00.000Z");
  assert.equal(showUpdatedDate(published, new Date("2026-06-11T18:00:00.000Z")), false);
  assert.equal(showUpdatedDate(published, new Date("2026-07-02T07:33:40.000Z")), true);
});
