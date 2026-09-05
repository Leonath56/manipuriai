// Stage 6 §6 audit helper: icon-only buttons with no accessible name.
//
// The opening tag has to be found with a brace-aware scan, not a regex: a `>`
// inside `{images.length >= MAX_IMAGES}` ends a naive non-greedy match early and
// reports buttons that are in fact labelled.
import fs from "node:fs";
import path from "node:path";

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Returns the opening tag starting at `i`, or null if it never closes. */
function readTag(src, i) {
  let depth = 0;
  let quote = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(i, j + 1);
  }
  return null;
}

let n = 0;
for (const f of walk("src")) {
  if (f.includes(path.join("components", "ui"))) continue;
  const src = fs.readFileSync(f, "utf8");
  const re = /<(Button|button)\b/g;
  let m;
  while ((m = re.exec(src))) {
    const tag = readTag(src, m.index);
    if (!tag || !/size="icon"/.test(tag)) continue;
    if (/aria-label|aria-labelledby|title=/.test(tag)) continue;
    const after = src.slice(m.index + tag.length, m.index + tag.length + 400);
    if (/sr-only/.test(after)) continue;
    console.log(f.split(path.sep).join("/") + ":" + src.slice(0, m.index).split("\n").length);
    n++;
  }
}
console.log("unlabeled icon buttons: " + n);
