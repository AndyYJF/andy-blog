import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(): string {
  const starts = [
    path.dirname(fileURLToPath(import.meta.url)),
    process.cwd(),
    path.resolve(process.cwd(), ".."),
  ];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 10; i += 1) {
      if (existsSync(path.join(dir, "data", "meta-route-map.json"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error("cannot locate data/meta-route-map.json from build context");
}

const ROOT = findRepoRoot();

export type MetaRoute = {
  type: "category" | "tag";
  routeId: string;
  canonicalPath: string;
  name?: string;
  sourceSlug: string;
  legacyPaths?: string[];
  state: string;
};

export function loadMetaRouteMap(): Record<string, MetaRoute> {
  return JSON.parse(readFileSync(path.join(ROOT, "data/meta-route-map.json"), "utf8"));
}

export function activeMetaOfType(type: "category" | "tag") {
  return Object.entries(loadMetaRouteMap())
    .filter(([, m]) => m.state === "active" && m.type === type)
    .map(([mid, meta]) => ({ mid: Number(mid), meta }));
}
