import { readFile } from "node:fs/promises";
import path from "node:path";
import routes from "@/data/concepts/routes.json";
export function conceptRoutes() {
  return routes.map((key) => ({
    slug: key === "/index.html" ? [] : key.slice(1, -5).split("/"),
  }));
}
export async function conceptDocument(slug = []) {
  const key = slug.length ? "/" + slug.join("/") + ".html" : "/index.html";
  if (!routes.includes(key)) return null;
  return {
    ...JSON.parse(
      await readFile(
        path.join(
          process.cwd(),
          "src/data/concepts",
          key.slice(1, -5).replaceAll("/", "-") + ".json",
        ),
        "utf8",
      ),
    ),
    key,
  };
}
