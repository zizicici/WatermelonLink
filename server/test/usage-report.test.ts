import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);

test("usage report shows UTC daily uniques and hides internal hashes from JSON", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "watermelon-link-report-"));
  const path = join(directory, "usage.json");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const day = new Date().toISOString().slice(0, 10);
  const breakdown = {
    total: 2,
    browsers: { Edge: 2 },
    operatingSystems: { macOS: 2 },
    uniqueNetworks: 1,
    uniqueNetworksCapped: false,
    networkHashes: ["A".repeat(22)]
  };
  await writeFile(path, JSON.stringify({
    version: 1,
    days: { [day]: { generatedLinks: breakdown, successfulConnections: breakdown } }
  }));
  const script = join(process.cwd(), "scripts", "usage-report.mjs");

  const textReport = await run(process.execPath, [script, path, "30"]);
  assert.match(textReport.stdout, /Date \(UTC\).*Gen unique.*Conn unique/);
  assert.match(textReport.stdout, new RegExp(`${day}\\s+2\\s+1\\s+2\\s+1`));

  const jsonReport = await run(process.execPath, [script, path, "30", "--json"]);
  assert.equal(jsonReport.stdout.includes("networkHashes"), false);
  assert.equal(JSON.parse(jsonReport.stdout).days[day].generatedLinks.uniqueNetworks, 1);
});
