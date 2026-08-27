import { visit } from "unist-util-visit";

function classList(node) {
  const raw = node.properties?.className ?? [];
  return Array.isArray(raw) ? raw.map(String) : String(raw).split(/\s+/).filter(Boolean);
}

/** Wrap markdown tables so wide grids scroll inside the column instead of blowing the page. */
export function rehypeWrapTables() {
  return (tree) => {
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "table" || !parent || typeof index !== "number") return;
      if (parent.tagName === "div" && classList(parent).includes("table-scroll")) return;
      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: { className: ["table-scroll"] },
        children: [node],
      };
    });
  };
}
