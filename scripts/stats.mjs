// Genera assets/stats.svg y assets/activity.svg con datos reales de GitHub.
// Uso: GITHUB_TOKEN=... node scripts/stats.mjs [usuario]
import { writeFileSync, mkdirSync } from "node:fs";

const USER = process.argv[2] || process.env.GH_USER || "daniellelooo";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("Falta GITHUB_TOKEN");

const C = { bg: "#161b22", border: "#30363d", text: "#c9d1d9", muted: "#7d8590", a: "#7c5cff", b: "#22d3ee", title: "#e6edf3" };
const FONT = `-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`;

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const data = await gql(
  `query($login: String!) {
    user(login: $login) {
      createdAt
      repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) {
        totalCount
        nodes { stargazerCount languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } } }
      }
      contributionsCollection {
        totalCommitContributions
        totalPullRequestContributions
        restrictedContributionsCount
        contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
      }
    }
  }`,
  { login: USER }
);

const u = data.user;
const cc = u.contributionsCollection;
const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
const activeDays = days.filter((d) => d.contributionCount > 0).length;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// Racha actual y más larga
let longest = 0, run = 0;
for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
let current = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].contributionCount > 0) current++;
  else if (i === days.length - 1) continue; // hoy todavía sin aportes no rompe la racha
  else break;
}

// Lenguajes por tamaño en los repos públicos
const langs = {};
for (const r of u.repositories.nodes) for (const e of r.languages.edges) {
  langs[e.node.name] ??= { size: 0, color: e.node.color || C.muted };
  langs[e.node.name].size += e.size;
}
const top = Object.entries(langs).sort((x, y) => y[1].size - x[1].size).slice(0, 6);
const totalSize = top.reduce((s, [, v]) => s + v.size, 0) || 1;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const fmt = (n) => n.toLocaleString("en-US");

// --- Tarjeta de estadísticas ---
const items = [
  ["Contributions (last year)", fmt(cc.contributionCalendar.totalContributions)],
  ["Commits (last year)", fmt(cc.totalCommitContributions + cc.restrictedContributionsCount)],
  ["Current streak", plural(current, "day")],
  ["Longest streak", plural(longest, "day")],
  ["Active days (last year)", fmt(activeDays)],
  ["Public repos", fmt(u.repositories.totalCount)],
];
let x = 0;
const bar = top.map(([, v]) => {
  const w = (v.size / totalSize) * 340;
  const r = `<rect x="${(x + 400).toFixed(1)}" y="64" width="${w.toFixed(1)}" height="10" fill="${v.color}"/>`;
  x += w;
  return r;
}).join("");
const legend = top.map(([name, v], i) => {
  const lx = 400 + (i % 2) * 175, ly = 102 + Math.floor(i / 2) * 26;
  return `<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${v.color}"/><text x="${lx + 16}" y="${ly}" fill="${C.text}" font-size="13">${esc(name)} <tspan fill="${C.muted}">${((v.size / totalSize) * 100).toFixed(1)}%</tspan></text>`;
}).join("");

const stats = `<svg xmlns="http://www.w3.org/2000/svg" width="780" height="200" viewBox="0 0 780 200" font-family="${FONT}">
<style>.row{opacity:0;animation:in .5s ease-out forwards}@keyframes in{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}</style>
<rect x="0.5" y="0.5" width="779" height="199" rx="10" fill="${C.bg}" stroke="${C.border}"/>
<text x="28" y="40" fill="${C.title}" font-size="17" font-weight="700">GitHub stats</text>
${items.map(([k, v], i) => `<g class="row" style="animation-delay:${i * 0.12}s"><text x="28" y="${74 + i * 22}" fill="${C.muted}" font-size="14">${k}</text><text x="330" y="${74 + i * 22}" fill="${C.text}" font-size="14" font-weight="700" text-anchor="end">${v}</text></g>`).join("")}
<line x1="370" y1="28" x2="370" y2="176" stroke="${C.border}"/>
<text x="400" y="40" fill="${C.title}" font-size="17" font-weight="700">Top languages</text>
<clipPath id="r"><rect x="400" y="64" width="340" height="10" rx="5"/></clipPath>
<g clip-path="url(#r)">${bar}</g>
${legend}
</svg>`;

// --- Gráfica de actividad (últimas 26 semanas, total semanal) ---
const weeks = cc.contributionCalendar.weeks.slice(-26).map((w) => w.contributionDays.reduce((s, d) => s + d.contributionCount, 0));
const W = 780, H = 220, P = { l: 44, r: 24, t: 48, b: 34 };
const max = Math.max(...weeks, 1);
const px = (i) => P.l + (i / (weeks.length - 1)) * (W - P.l - P.r);
const py = (v) => H - P.b - (v / max) * (H - P.t - P.b);
const pts = weeks.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`);
const line = `M${pts.join(" L")}`;
const area = `${line} L${px(weeks.length - 1).toFixed(1)},${H - P.b} L${P.l},${H - P.b} Z`;
const grid = [0, 0.5, 1].map((f) => {
  const y = py(max * f).toFixed(1);
  return `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" stroke="${C.border}" stroke-dasharray="3 4"/><text x="${P.l - 8}" y="${+y + 4}" fill="${C.muted}" font-size="11" text-anchor="end">${Math.round(max * f)}</text>`;
}).join("");
const firstWeek = cc.contributionCalendar.weeks.slice(-26)[0].contributionDays[0].date;
const activity = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.a}" stop-opacity=".45"/><stop offset="1" stop-color="${C.a}" stop-opacity="0"/></linearGradient>
<linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.a}"/><stop offset="1" stop-color="${C.b}"/></linearGradient></defs>
<style>.ln{stroke-dasharray:3000;stroke-dashoffset:3000;animation:draw 2.2s ease-out forwards}@keyframes draw{to{stroke-dashoffset:0}}.ar{opacity:0;animation:fade 1s 1.4s forwards}@keyframes fade{to{opacity:1}}</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${C.bg}" stroke="${C.border}"/>
<text x="28" y="32" fill="${C.title}" font-size="17" font-weight="700">Contributions per week</text>
<text x="${W - P.r}" y="32" fill="${C.muted}" font-size="12" text-anchor="end">last 26 weeks · since ${firstWeek}</text>
${grid}
<path class="ar" d="${area}" fill="url(#g)"/>
<path class="ln" d="${line}" fill="none" stroke="url(#s)" stroke-width="2.5" stroke-linejoin="round"/>
</svg>`;

mkdirSync("assets", { recursive: true });
writeFileSync("assets/stats.svg", stats);
writeFileSync("assets/activity.svg", activity);
console.log(`ok: ${cc.contributionCalendar.totalContributions} aportes, racha ${current}/${longest}, ${top.length} lenguajes`);
