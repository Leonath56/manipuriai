// Release check: scan the built client assets for server-only secret names and
// JWT-shaped strings, and report the largest client chunks. Run after a build:
//   node scripts/bundle-scan.mjs
// Any non-zero count means a server-only value reached the browser bundle.
import fs from "node:fs";
import path from "node:path";

const files = [];
function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
}
walk(".output/public");

if (files.length === 0) {
  console.error("No built assets found — run the production build first.");
  process.exit(1);
}

const js = files.filter((f) => f.endsWith(".js"));
const needles = [
  "SERVICE_ROLE",
  "LOVABLE_API_KEY",
  "GEMINI_API_KEY",
  "RAZORPAY_KEY_SECRET",
  "FIRECRAWL_API_KEY",
  "supabaseAdmin",
  "client.server",
];
const hits = Object.fromEntries(needles.map((n) => [n, 0]));
let jwtHits = 0;
const jwt = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./g;

for (const f of js) {
  const src = fs.readFileSync(f, "utf8");
  for (const n of needles) if (src.includes(n)) hits[n]++;
  jwtHits += (src.match(jwt) || []).length;
}

console.log(`client js assets scanned: ${js.length}`);
for (const n of needles) console.log(`  ${n}: ${hits[n]} file(s)`);
console.log(`  JWT-shaped strings: ${jwtHits}`);

const sized = js
  .map((f) => ({ f: path.basename(f), kb: fs.statSync(f).size / 1024 }))
  .sort((a, b) => b.kb - a.kb);
const total = sized.reduce((s, x) => s + x.kb, 0);
console.log(`\nclient JS total: ${total.toFixed(0)} kB across ${sized.length} files`);
console.log("largest 8:");
for (const s of sized.slice(0, 8)) console.log(`  ${s.kb.toFixed(0)} kB  ${s.f}`);

const leaked = needles.filter((n) => hits[n] > 0).length + (jwtHits > 0 ? 1 : 0);
process.exit(leaked > 0 ? 1 : 0);
