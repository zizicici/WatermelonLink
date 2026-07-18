import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const json = args.includes("--json");
const values = args.filter((value) => value !== "--json");
const firstIsDays = values[0] !== undefined && /^\d+$/.test(values[0]);
const path = firstIsDays ? "/var/lib/watermelon-link/usage.json" : values[0] ?? "/var/lib/watermelon-link/usage.json";
const requestedDays = Number(firstIsDays ? values[0] : values[1] ?? 30);
if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 100) {
  throw new Error("days must be an integer between 1 and 100");
}

let stored;
try {
  stored = JSON.parse(await readFile(path, "utf8"));
} catch (error) {
  if (error?.code === "ENOENT") {
    console.log("No Watermelon Link usage has been recorded yet.");
    process.exit(0);
  }
  throw error;
}

if ((stored?.version !== 1 && stored?.version !== 2) || !stored.days || typeof stored.days !== "object" ||
    (stored.version === 2 && (!stored.hours || typeof stored.hours !== "object"))) {
  throw new Error("unsupported usage metrics file");
}

const dayCutoff = new Date(Date.now() - (requestedDays - 1) * 86_400_000).toISOString().slice(0, 10);
const hourCutoff = `${dayCutoff}T00`;
const days = sortedEntries(stored.days, dayCutoff);
const hours = sortedEntries(stored.version === 2 ? stored.hours : {}, hourCutoff);
const lifetime = stored.version === 2 && stored.lifetime
  ? stored.lifetime
  : totalsFor(Object.entries(stored.days));

if (json) {
  console.log(JSON.stringify({
    version: 2,
    lifetime: publicTotals(lifetime),
    hours: publicPeriods(hours),
    days: publicPeriods(days)
  }, null, 2));
  process.exit(0);
}

const totals = totalsFor(days);

console.log(`Watermelon Link usage — last ${requestedDays} UTC days`);
console.log("");
console.log("Hourly activity");
if (hours.length === 0) {
  console.log("No hourly detail in this period.");
} else {
  printPeriods("Hour (UTC)        Generated  Gen unique  Connected  Conn unique", hours, (hour) => `${hour}:00`, 16);
}
console.log("");
console.log("Daily totals");
if (days.length === 0) {
  console.log("No usage in this period.");
} else {
  printPeriods("Date (UTC)  Generated  Gen unique  Connected  Conn unique", days, (day) => day, 10);
}
console.log("");
console.log(`Window generated: ${totals.generatedLinks.total}`);
console.log(`Window connected: ${totals.successfulConnections.total}`);
console.log(`Window daily unique generated networks: ${formatUnique(totals.generatedLinks)}`);
console.log(`Window daily unique connected networks: ${formatUnique(totals.successfulConnections)}`);
console.log("");
console.log("All-time totals");
console.log(`Generated: ${lifetime.generatedLinks.total}`);
console.log(`Connected: ${lifetime.successfulConnections.total}`);
console.log(`Generated browsers: ${formatCounts(lifetime.generatedLinks.browsers)}`);
console.log(`Generated systems: ${formatCounts(lifetime.generatedLinks.operatingSystems)}`);
console.log(`Connected browsers: ${formatCounts(lifetime.successfulConnections.browsers)}`);
console.log(`Connected systems: ${formatCounts(lifetime.successfulConnections.operatingSystems)}`);

function sortedEntries(periods, cutoff) {
  return Object.entries(periods)
    .filter(([period]) => period >= cutoff)
    .sort(([left], [right]) => left.localeCompare(right));
}

function publicPeriods(periods) {
  return Object.fromEntries(periods.map(([period, usage]) => [period, {
    generatedLinks: publicBreakdown(usage.generatedLinks),
    successfulConnections: publicBreakdown(usage.successfulConnections)
  }]));
}

function printPeriods(header, periods, label, labelWidth) {
  console.log(header);
  for (const [period, usage] of periods) {
    console.log(
      `${label(period).padEnd(labelWidth)}  ${String(usage.generatedLinks.total).padStart(9)}  ` +
      `${formatUnique(usage.generatedLinks).padStart(10)}  ${String(usage.successfulConnections.total).padStart(9)}  ` +
      `${formatUnique(usage.successfulConnections).padStart(11)}`
    );
  }
}

function emptyPublicBreakdown() {
  return { total: 0, browsers: {}, operatingSystems: {}, uniqueNetworks: 0, uniqueNetworksCapped: false };
}

function totalsFor(periods) {
  const totals = {
    generatedLinks: emptyPublicBreakdown(),
    successfulConnections: emptyPublicBreakdown()
  };
  for (const [, usage] of periods) {
    mergeBreakdown(totals.generatedLinks, usage.generatedLinks);
    mergeBreakdown(totals.successfulConnections, usage.successfulConnections);
  }
  return totals;
}

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

function publicTotals(value) {
  return {
    generatedLinks: publicTotalsBreakdown(value.generatedLinks),
    successfulConnections: publicTotalsBreakdown(value.successfulConnections)
  };
}

function publicTotalsBreakdown(value) {
  return {
    total: value.total,
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
