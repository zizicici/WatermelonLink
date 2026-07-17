import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const json = args.includes("--json");
const values = args.filter((value) => value !== "--json");
const firstIsDays = values[0] !== undefined && /^\d+$/.test(values[0]);
const path = firstIsDays ? "/var/lib/watermelon-link/usage.json" : values[0] ?? "/var/lib/watermelon-link/usage.json";
const requestedDays = Number(firstIsDays ? values[0] : values[1] ?? 30);
if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 3_650) {
  throw new Error("days must be an integer between 1 and 3650");
}

let state;
try {
  state = JSON.parse(await readFile(path, "utf8"));
} catch (error) {
  if (error?.code === "ENOENT") {
    console.log("No Watermelon Link usage has been recorded yet.");
    process.exit(0);
  }
  throw error;
}

if (state?.version !== 1 || !state.days || typeof state.days !== "object") {
  throw new Error("unsupported usage metrics file");
}

const cutoff = new Date(Date.now() - (requestedDays - 1) * 86_400_000).toISOString().slice(0, 10);
const days = Object.entries(state.days)
  .filter(([day]) => day >= cutoff)
  .sort(([left], [right]) => left.localeCompare(right));

if (json) {
  console.log(JSON.stringify({ version: 1, days: Object.fromEntries(days.map(([day, usage]) => [day, {
    generatedLinks: publicBreakdown(usage.generatedLinks),
    successfulConnections: publicBreakdown(usage.successfulConnections)
  }])) }, null, 2));
  process.exit(0);
}

const totals = {
  generatedLinks: { total: 0, browsers: {}, operatingSystems: {}, uniqueNetworks: 0, uniqueNetworksCapped: false },
  successfulConnections: { total: 0, browsers: {}, operatingSystems: {}, uniqueNetworks: 0, uniqueNetworksCapped: false }
};
for (const [, usage] of days) {
  mergeBreakdown(totals.generatedLinks, usage.generatedLinks);
  mergeBreakdown(totals.successfulConnections, usage.successfulConnections);
}

console.log(`Watermelon Link usage — last ${requestedDays} UTC days`);
if (days.length === 0) {
  console.log("No usage in this period.");
  process.exit(0);
}
console.log("");
console.log("Date (UTC)  Generated  Gen unique  Connected  Conn unique");
for (const [day, usage] of days) {
  console.log(
    `${day}  ${String(usage.generatedLinks.total).padStart(9)}  ` +
    `${formatUnique(usage.generatedLinks).padStart(10)}  ${String(usage.successfulConnections.total).padStart(9)}  ` +
    `${formatUnique(usage.successfulConnections).padStart(11)}`
  );
}
console.log("");
console.log(`Generated: ${totals.generatedLinks.total}`);
console.log(`Connected: ${totals.successfulConnections.total}`);
console.log(`Daily unique generated networks: ${formatUnique(totals.generatedLinks)}`);
console.log(`Daily unique connected networks: ${formatUnique(totals.successfulConnections)}`);
console.log(`Generated browsers: ${formatCounts(totals.generatedLinks.browsers)}`);
console.log(`Generated systems: ${formatCounts(totals.generatedLinks.operatingSystems)}`);
console.log(`Connected browsers: ${formatCounts(totals.successfulConnections.browsers)}`);
console.log(`Connected systems: ${formatCounts(totals.successfulConnections.operatingSystems)}`);

function mergeBreakdown(target, source) {
  target.total += source.total;
  target.uniqueNetworks += source.uniqueNetworks;
  target.uniqueNetworksCapped ||= source.uniqueNetworksCapped;
  mergeCounts(target.browsers, source.browsers);
  mergeCounts(target.operatingSystems, source.operatingSystems);
}

function publicBreakdown(value) {
  return {
    total: value.total,
    uniqueNetworks: value.uniqueNetworks,
    uniqueNetworksCapped: value.uniqueNetworksCapped,
    browsers: value.browsers,
    operatingSystems: value.operatingSystems
  };
}

function formatUnique(value) {
  return `${value.uniqueNetworks}${value.uniqueNetworksCapped ? "+" : ""}`;
}

function mergeCounts(target, source) {
  for (const [key, count] of Object.entries(source)) target[key] = (target[key] ?? 0) + count;
}

function formatCounts(counts) {
  const entries = Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return entries.length === 0 ? "none" : entries.map(([key, count]) => `${key} ${count}`).join(", ");
}
