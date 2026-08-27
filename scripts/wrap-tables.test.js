import assert from "node:assert/strict";
import test from "node:test";
import { rehypeWrapTables } from "../astro/src/plugins/rehype-wrap-tables.js";

function run(tree) {
  rehypeWrapTables()(tree);
  return tree;
}

test("wraps a table in .table-scroll", () => {
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "table",
        properties: {},
        children: [],
      },
    ],
  };
  run(tree);
  const wrap = tree.children[0];
  assert.equal(wrap.tagName, "div");
  assert.deepEqual(wrap.properties.className, ["table-scroll"]);
  assert.equal(wrap.children[0].tagName, "table");
});

test("does not double-wrap an existing table-scroll", () => {
  const table = { type: "element", tagName: "table", properties: {}, children: [] };
  const tree = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "div",
        properties: { className: ["table-scroll"] },
        children: [table],
      },
    ],
  };
  run(tree);
  assert.equal(tree.children[0].tagName, "div");
  assert.equal(tree.children[0].children[0].tagName, "table");
  assert.equal(tree.children[0].children[0].children?.length ?? 0, 0);
});
