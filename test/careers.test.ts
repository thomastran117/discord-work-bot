import { test } from "node:test";
import assert from "node:assert/strict";
import { CAREERS, parseWorkdayList, enrichWorkday, parseOraclePage, fetchWorkday, fetchOracle } from "../src/sources/careers.ts";
import { loadConfig } from "../src/config.ts";
import { urlIdentity } from "../src/services/identity.ts";
import { eligible } from "../src/services/classifier.ts";
import { SourceHttpClient } from "../src/utils/http.ts";

function mockedHttp(request: typeof fetch) {
  let now = 1_800_000_000_000;
  return new SourceHttpClient({request, now: () => now, sleep: async ms => { now += ms; }, event: () => {}});
}

const listRow = { title: "Software Engineer - New Grad", externalPath: "/job/Ottawa/Software-Engineer_R1234", locationsText: "Ottawa, Canada", bulletFields: ["R1234"] };
const detail = { jobPostingInfo: { title: listRow.title, location: "Ottawa", jobReqId: "R1234", timeType: "Full time", jobDescription: "<p>New graduates welcome</p>", startDate: "2026-11-17", additionalLocations: ["Toronto, ON"], jobRequisitionLocation: { country: { alpha2Code: "CA" } } } };
const oracleRow = { Id: "30015", Title: "Firmware Engineer - New Grad", PrimaryLocation: "Ottawa", PrimaryLocationCountry: "CA", ShortDescriptionStr: "<p>Early career</p>", PostedDate: "2026-11-15", secondaryLocations: [{ Name: "Toronto", Country: "CA" }] };

test("direct career sources are enabled in default configuration", () => {
  assert.deepEqual(loadConfig({}).careers, ["ciena","rbc","nokia"]);
});
test("Workday list and detail normalize without inventing employment start date", () => {
  const page = parseWorkdayList(CAREERS.ciena, {total: 1, jobPostings: [listRow]});
  const job = enrichWorkday(page.jobs[0], detail);
  assert.equal(job.company, "Ciena");
  assert.deepEqual(job.locations, ["Ottawa","Toronto, ON"]);
  assert.equal(job.postedAt, "2026-11-17T00:00:00.000Z");
  assert.equal(job.startDate, undefined);
  assert.equal(job.requisitionKey, "ciena:R1234");
  assert.ok(eligible(job));
  assert.throws(() => parseWorkdayList(CAREERS.ciena, { total: 1, jobPostings: [{}] }));
});

test("Workday searches using POST and fetches detail once per unique posting", async () => {
  let searches = 0, details = 0;
  const request = async (url: URL | RequestInfo, init?: RequestInit) => {
    if (String(url).endsWith("/jobs")) {
      searches++;
      assert.equal(init?.method, "POST");
      assert.equal(JSON.parse(String(init?.body)).limit, 20);
      return Response.json({ total: 1, jobPostings: [listRow] });
    }
    details++;
    assert.match(String(url), /\/wday\/cxs\/rbc\/RBCGLOBAL1\/job\/Ottawa/);
    return Response.json(detail);
  };
  const jobs = await fetchWorkday(CAREERS.rbc, mockedHttp(request as typeof fetch));
  assert.equal(searches, 6);
  assert.equal(details, 1);
  assert.equal(jobs[0].company, "RBC");
});

test("Oracle parses public requisitions and Canada search pagination", async () => {
  const calls: string[] = [];
  const request = async (url: URL | RequestInfo) => {
    const finder = new URL(String(url)).searchParams.get("finder")!;
    calls.push(finder);
    return Response.json({items:[{ TotalJobsCount: 2, requisitionList: [
      finder.includes("offset=0") ? oracleRow : {...oracleRow, Id: "30016"}
    ] }]});
  };
  const jobs = await fetchOracle(CAREERS.nokia, mockedHttp(request as typeof fetch));
  assert.equal(jobs.length, 2);
  assert.match(calls[0], /locationId=300000000471544/);
  assert.match(calls[1], /offset=1/);
  assert.equal(jobs[0].url, CAREERS.nokia.origin + "/hcmUI/CandidateExperience/en/sites/CX_1/job/30015");
  assert.ok(eligible(jobs[0]));
  assert.throws(() => parseOraclePage(CAREERS.nokia, {items: []}));
});
test("career identities ignore locale and known Nokia host aliases", () => {
  assert.equal(urlIdentity("https://ciena.wd5.myworkdayjobs.com/en-US/Careers/job/Ottawa/Software-Engineer_R1234"), urlIdentity("https://ciena.wd5.myworkdayjobs.com/Careers/job/Ottawa/Other_R1234"));
  assert.equal(urlIdentity("https://jobs.nokia.com/en/sites/CX_1/job/30015"), urlIdentity(CAREERS.nokia.origin + "/hcmUI/CandidateExperience/en/sites/CX_1/job/30015"));
  assert.notEqual(urlIdentity("https://ciena.wd5.myworkdayjobs.com/Careers/job/Other_R1234-1"), urlIdentity("https://ciena.wd5.myworkdayjobs.com/Careers/job/Other_R1234"));
});
