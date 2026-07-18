import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);

test("usage report shows UTC hourly and daily uniques and hides internal hashes from JSON", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "watermelon-link-report-"));
  const path = join(directory, "usage.json");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const day = new Date().toISOString().slice(0, 10);
  const hour = `${day}T08`;
  const breakdown = {
    total: 2,
    browsers: { Edge: 2 },
    operatingSystems: { macOS: 2 },
    uniqueNetworks: 1,
    uniqueNetworksCapped: false,
    networkHashes: ["A".repeat(22)]
  };
  await writeFile(path, JSON.stringify({
    version: 2,
    lifetime: {
      generatedLinks: { total: 4, browsers: { Edge: 4 }, operatingSystems: { macOS: 4 } },
      successfulConnections: { total: 3, browsers: { Edge: 3 }, operatingSystems: { macOS: 3 } }
    },
    days: { [day]: { generatedLinks: breakdown, successfulConnections: breakdown } },
    hours: { [hour]: { generatedLinks: breakdown, successfulConnections: breakdown } }
  }));
  const script = join(process.cwd(), "scripts", "usage-report.mjs");

  const textReport = await run(process.execPath, [script, path, "30"]);
  assert.match(textReport.stdout, /Hour \(UTC\).*Gen unique.*Conn unique/);
  assert.match(textReport.stdout, new RegExp(`${hour}:00\\s+2\\s+1\\s+2\\s+1`));
  assert.match(textReport.stdout, /Date \(UTC\).*Gen unique.*Conn unique/);
  assert.match(textReport.stdout, new RegExp(`${day}\\s+2\\s+1\\s+2\\s+1`));
  assert.match(textReport.stdout, /All-time totals[\s\S]*Generated: 4[\s\S]*Connected: 3/);

  const jsonReport = await run(process.execPath, [script, path, "30", "--json"]);
  assert.equal(jsonReport.stdout.includes("networkHashes"), false);
  const output = JSON.parse(jsonReport.stdout);
  assert.equal(output.lifetime.generatedLinks.total, 4);
  assert.equal(output.hours[hour].generatedLinks.uniqueNetworks, 1);
  assert.equal(output.days[day].generatedLinks.uniqueNetworks, 1);
});

test("usage report continues to read version 1 daily files", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "watermelon-link-report-v1-"));
  const path = join(directory, "usage.json");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const day = new Date().toISOString().slice(0, 10);
  const breakdown = {
    total: 1,
    browsers: { Chrome: 1 },
    operatingSystems: { Windows: 1 },
    uniqueNetworks: 1,
    uniqueNetworksCapped: false,
    networkHashes: ["A".repeat(22)]
  };
  await writeFile(path, JSON.stringify({
    version: 1,
    days: { [day]: { generatedLinks: breakdown, successfulConnections: breakdown } }
  }));

  const script = join(process.cwd(), "scripts", "usage-report.mjs");
  const report = await run(process.execPath, [script, path, "30"]);
  assert.match(report.stdout, /No hourly detail in this period/);
  assert.match(report.stdout, new RegExp(`${day}\\s+1\\s+1\\s+1\\s+1`));
});

test("usage report shows all-time totals when the selected window is empty", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "watermelon-link-report-lifetime-"));
  const path = join(directory, "usage.json");
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path, JSON.stringify({
    version: 2,
    lifetime: {
      generatedLinks: { total: 8, browsers: { Chrome: 8 }, operatingSystems: { Windows: 8 } },
      successfulConnections: { total: 5, browsers: { Chrome: 5 }, operatingSystems: { Windows: 5 } }
    },
    days: {},
    hours: {}
  }));

  const script = join(process.cwd(), "scripts", "usage-report.mjs");
  const report = await run(process.execPath, [script, path, "1"]);
  assert.match(report.stdout, /No usage in this period/);
  assert.match(report.stdout, /All-time totals[\s\S]*Generated: 8[\s\S]*Connected: 5/);
});
