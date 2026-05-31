import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
const dist = "dist";
const postsDir = "src/content/posts";
const html = (target) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${target}"><link rel="canonical" href="${target}"><script>location.replace(${JSON.stringify(target)})</script><title>Redirecting...</title></head><body><a href="${target}">Redirecting to ${target}</a></body></html>`;
function writeRedirect(path, target) {
  const dir = join(dist, path.replace(/^\//, ""));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html(target));
}
const tags = new Set();
for (const file of readdirSync(postsDir).filter(f => f.endsWith(".md") || f.endsWith(".mdx"))) {
  const slug = basename(file).replace(/\.mdx?$/, "");
  writeRedirect(`/post/${slug}/`, `/posts/${slug}/`);
  writeRedirect(`/${slug}/`, `/posts/${slug}/`);
  const text = readFileSync(join(postsDir, file), "utf8");
  const m = text.match(/\ntags:\s*\[([^\]]*)\]/);
  if (m) for (const raw of m[1].split(",")) {
    const t = raw.trim().replace(/^['"]|['"]$/g, "");
    if (t) tags.add(t);
  }
}
for (const tag of tags) {
  for (const alias of new Set([tag, tag.toLowerCase()])) {
    writeRedirect(`/tags/${encodeURIComponent(alias)}/`, `/archive/?tag=${encodeURIComponent(tag)}`);
    writeRedirect(`/tag/${encodeURIComponent(alias)}/`, `/archive/?tag=${encodeURIComponent(tag)}`);
  }
}
