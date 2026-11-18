import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCurated, FEEDS } from "../src/sources/curated.ts";
import { loadConfig } from "../src/config.ts";
import { parseBoard } from "../src/sources/ats.ts";
import { eligible } from "../src/services/classifier.ts";
import { buildPayload } from "../src/services/discord.ts";
import { getText } from "../src/utils/http.ts";

test("default watchlist has distinct employers and optional curated feeds are off", () => {
  const config = loadConfig({});
  assert.equal(config.simplifyEnabled, true);
  assert.equal(config.boards.length, 16);
  assert.equal(new Set(config.boards.map(b => b.provider + ":" + b.board)).size, 16);
  assert.equal(config.boards.filter(b => b.mechanicalFocus).length, 5);
  assert.equal(loadConfig({MECHANICAL_FIRST_RUN_MODE:'publish'}).mechanicalSeedFirst, false);
  assert.equal(loadConfig({MECHANICAL_FIRST_RUN_MODE:'publish'}).seedFirst, true);
  assert.deepEqual(config.feeds, []);
  assert.equal(Object.keys(FEEDS).length, 3);
});

test("Vansh parser handles HTML apply links, multiple locations and closed rows", () => {
  const markdown = [
    "| Company | Role | Location | Application/Link | Date Posted |",
    "| --- | --- | --- | :---: | :---: |",
    '| **Company** | New Grad 2027: Software Engineer | Toronto, Canada</br>Remote | <a href="https://example.com/apply?s=B"><img src="icon.png" alt="Apply"></a> | Nov 17 |',
    '| ↳ | Backend Engineer | Ottawa, Canada | <a href="https://example.com/other">Apply</a> | Nov 16 |',
    "| **Closed Company** | Software Engineer | Toronto, Canada | 🔒 | Nov 11 |"
  ].join("\n");
  const jobs = parseCurated("vansh-canada", markdown);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1].company, "Company");
  assert.deepEqual(jobs[0].locations, ["Toronto, Canada", "Remote"]);
  assert.equal(jobs[0].postedAt, undefined);
  assert.ok(eligible(jobs[0]));
  assert.equal(buildPayload(jobs[0]).embeds[0].footer.text, "via Vansh New-Grad Canada");
});

test("Grind parser skips unrelated tables and splits countries", () => {
  const markdown = [
    "| | Field | Level | Country | Repo | Live |",
    "| | Software Engineering | New Grad | Canada | [Repo](https://example.com/repo) | link |",
    "## Top Companies",
    "| | Company | Role | Location | Extracted |",
    "|:-:|---------|------|----------|-----------|",
    "| 🔥 | Company | [Software Engineer - New Grad](https://example.com/apply?utm_source=test&t=123) | Canada; United States | 2026-11-09 |",
    "| | Other | [Software Engineer](https://example.com/other) | Canada | 2026-11-09 |"
  ].join("\n");
  const jobs = parseCurated("grind-canada", markdown);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].url, "https://example.com/apply?t=123");
  assert.deepEqual(jobs[0].locations, ["Canada", "United States"]);
  assert.equal(jobs[0].postedAt, undefined);
  assert.ok(eligible(jobs[0]));
  assert.equal(eligible(jobs[1]), false);
});

test("Intern Radar supports direct links, NEW marker, date and closed rows", () => {
  const markdown = [
    "| Company | Role | Location | Details | Posted | Apply |",
    "|---|---|---|---|---:|---|",
    '| Company | NEW Junior Software Engineer | Toronto, ON | - | Nov 16, 2026<br><sub>1 day old</sub> | <a href="https://example.com/apply">Apply</a> | <!--id:42-->',
    "| ~~Company~~ | ~~Junior Software Developer~~ | Toronto | - | Nov 6, 2026 | Closed | <!--id:43-->"
  ].join("\n");
  const jobs = parseCurated("intern-radar", markdown);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "Junior Software Engineer");
  assert.equal(jobs[0].postedAt, "2026-11-16T00:00:00.000Z");
  assert.ok(eligible(jobs[0]));
});

test("curated feed fails visibly when upstream layout changes", () => {
  assert.throws(() => parseCurated("grind-canada", "<html>error</html>"), /format changed/);
  assert.deepEqual(parseCurated("grind-canada", "| | Company | Role | Location | Extracted |\n|:-:|---|---|---|---|"), []);
});

test("structured Ashby country and experience titles improve direct employer matching", () => {
  const jobs = parseBoard({ provider: "ashby", company: "Example", board: "example" }, { jobs: [{
    id: "1", title: "Software Engineer", location: "London",
    address: { postalAddress: { addressLocality: "London", addressRegion: "ON", addressCountry: "CA" } },
    jobUrl: "https://example.com/apply", descriptionPlain: "1-2 years of professional experience",
    secondaryLocations: [{ location: "Ottawa", address: { postalAddress: { addressLocality: "Ottawa", addressCountry: "CA" } } }]
  }] });
  assert.deepEqual(jobs[0].locations, ["London, ON, Canada", "Ottawa, Canada"]);
  assert.ok(eligible(jobs[0]));
  assert.ok(eligible({ ...jobs[0], title: "SDE I", description: "" }));
  assert.equal(eligible({ ...jobs[0], title: "Software Developer II" }), true); // description supplies 1–2 years
  assert.equal(eligible({ ...jobs[0], title: "Software Developer II", description: "" }), false);
});

test("Markdown HTTP reader sends a text accept header and returns the body", async () => {
  const fakeFetch = async (_url: URL | RequestInfo, init?: RequestInit) => {
    assert.match(String(new Headers(init?.headers).get("accept")), /text\/plain/);
    return new Response("job table");
  };
  assert.equal(await getText("https://example.com/feed", fakeFetch as typeof fetch), "job table");
});
