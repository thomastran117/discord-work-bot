import type { Job, JobCategory } from "../models/job.ts";

const canada = /\b(canada|ontario|qu[eé]bec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland(?: and labrador)?|prince edward island|northwest territories|nunavut|yukon)\b/i;
const cities = /\b(toronto|waterloo|kitchener|ottawa|vancouver|montr[eé]al|calgary|edmonton|burnaby|markham|mississauga|victoria|halifax|winnipeg|saskatoon|regina|kanata|gatineau|qu[eé]bec city|laval|richmond hill|surrey|fredericton|oakville|burlington|kelowna|guelph)\b/i;
const provinceCodes = /(?:,\s*|\(\s*|\s+[-–—]\s+|\s+)(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|NT|NU|YT)(?=$|[,\)])/;
const delimitedProvince = /(?:,\s*|\(\s*)(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|NT|NU|YT)(?=$|[\s,)])/i;
const canadianCountryCode = /(?:^|[,\s(])CAN(?=$|[,\s)])/;
const foreignSuffix = /(?:\s+[-–—]\s+|\s+)(CA|WA|NY|TX|OR|MI|MA|OH|FL|IL|CO|VA|PA|NJ|MD|WI|MN|IN|NC|SC|GA|AZ|NV|CT|TN|MO|IA|ID|UT|NM|KS|OK|AR|LA|MS|AL|KY|NE|ND|SD|MT|WY|WV|VT|NH|ME|RI|DE|HI|AK)(?=$|[,)])/;
const foreign = /\b(united states|usa|u\.s\.|california|washington|texas|new york|united kingdom|uk|australia|india)\b|,\s*(CA|WA|NY|TX|OR|MI|MA|OH|FL|IL|CO|VA|PA|NJ|MD|WI|MN|IN|NC|SC|GA|AZ|NV|CT|TN|MO|IA|ID|UT|NM|KS|OK|AR|LA|MS|AL|KY|NE|ND|SD|MT|WY|WV|VT|NH|ME|RI|DE|HI|AK)(?=$|[,\s)])/i;
const role = /\b(?:software|backend|back[- ]end|frontend|front[- ]end|full[- ]stack|embedded|firmware|devops|sre|site reliability|platform|infrastructure|cloud|machine learning|data|security|distributed systems|systems|application|mobile|android|ios)\b.{0,35}\b(?:engineer(?:ing)?|developer|programmer)\b|\b(?:software developer|software engineer|swe|sde|devops|sre|développeur|développeuse|programmeur|ingénieur logiciel)\b/i;
// Include closely related technical roles, rather than requiring the exact
// words "software engineer". Generic developer/programmer titles still need
// early-career evidence; broad business/data analyst titles are not SWE.
const relatedSoftware = /\b(?:software development (?:specialist|associate)|web developer|(?:java|python|javascript|typescript|react|angular|c\+\+|c#|\.net|full[- ]?stack|backend|frontend|front[- ]end|back[- ]end|mobile|android|ios|application|api|game|unity|unreal|salesforce)\s+(?:developer|programmer)|(?:developer|programmer)\s+(?:analyst|i|ii|1|2)|sdet|software development engineer in test|(?:test|qa|quality assurance)\s+automation (?:engineer|developer|specialist)|automation test (?:engineer|developer)|(?:data|machine learning|applied)\s+scientist|(?:ml|ai)\s+engineer|analytics engineer|(?:cybersecurity|cyber security)\s+engineer)\b/i;
const softwareEvidence = /\b(?:software|programming|coding|software development|computer science|test automation|automated testing|python|java|javascript|typescript|sql|selenium|playwright|cypress|api testing)\b/i;
const ambiguousSoftware = /\b(?:qa engineer|qa analyst|quality assurance engineer|quality assurance analyst|test automation engineer|test engineer|automation engineer|test analyst|data analyst|business intelligence developer|research scientist)\b/i;
const genericDeveloper = /^(?:(?:junior|jr\.?|associate|graduate|entry[- ]level)\s+)?(?:developer|programmer)(?:\s*[-–—,]\s*.*|\s+(?:i|ii|1|2))?$/i;
export function isSweCandidateTitle(title: string): boolean {
  return role.test(title) || relatedSoftware.test(title) || genericDeveloper.test(title) || ambiguousSoftware.test(title);
}
const mechanical = /\b(?:mechanical|electro[- ]?mechanical|electrom[eé]canique|mechatronics|m[eé]catronique|manufacturing|fabrication|industrial|automotive|aerospace|a[eé]rospatiale|aeronautical|thermal|hvac|cvac|refrigeration|r[eé]frig[eé]ration|tooling|m[eé]canique)\b/i;
const adjacent = /\b(?:robotics|robotique|product design|design|process|quality|controls?|test|validation|maintenance|stress|piping|commissioning|fire protection|building services|systems assurance|rams)\b/i;
const engineering = /\b(?:engineer(?:ing)?|eng\.?|designer|eit|e\.i\.t\.?|ing\.?|ing[eé]nieur(?:e)?|g[eé]nie|concepteur(?:rice)?|cpi)\b/i;
const software = /\b(?:software|firmware|swe|sde|developer|programmer|logiciel|devops|sre|backend|back[- ]end|frontend|front[- ]end|full[- ]stack|machine learning|data engineer|site reliability|cloud engineer)\b/i;
const degree = /\b(?:mechanical|mechatronics|manufacturing|aerospace|aeronautical|industrial) engineering\b|g[eé]nie (?:m[eé]canique|industriel|a[eé]rospatial)/i;
const unrelated = /\b(?:civil|structural|geotechnical|environmental|electrical|chemical|mining|geological)\b/i;
export function hasMechanicalEarlyTitle(title: string): boolean {
  return early.test(title) || /\b(?:graduate|eit|e\.i\.t\.?|engineer[- ]in[- ]training|engineering trainee|engineer trainee|cpi|jr\.?|junior[e]?|dipl[oô]m[eé](?:e)?|finissant[e]?|entry[- ]level)\b/i.test(title);
}
export function isMechanicalCandidate(title: string): boolean {
  if (software.test(title) || !engineering.test(title)) return false;
  if (mechanical.test(title)) return true;
  return !unrelated.test(title) && (adjacent.test(title) || hasMechanicalEarlyTitle(title));
}
const early = /\b(?:new[- ]grad(?:uate)?|recent graduate|university graduate|early[- ]career|entry[- ]level|junior|graduate (?:program|engineer|developer)|associate (?:software|engineer|developer)|(?:engineer|developer|programmer|sde|swe)\s+(?:i|1)|early in career|graduate software)\b|nouveau[x]? diplômé|débutant/i;
// Level numbering varies by company. Level II can be explicitly early
// career (e.g. Google's Software Developer 2 – Early Career).
const hardExclusion = /\b(?:senior|staff|principal|manager|director|intern(?:ship)?|co[- ]?op|sr|lead|stagiaire|(?:engineer|developer|sde|swe)\s+(?:iii|iv|3|4)|mid[- ]level|intermediate)\b/i;
const levelTwo = /\b(?:engineer|developer|sde|swe)\s+(?:ii|2)\b/i;
const descriptionEarly = /\b(?:new graduates?|recent graduates?|early[- ]career|entry[- ]level|[01]\s*(?:[-–—]|to)\s*[12]\s+years?|[01]\+?\s+years?\s+(?:of\s+)?(?:professional|relevant|software|work)\s+experience)\b/i;


export function isCanadian(location: string): boolean {
  return location.split(/\s*[;|\n]\s*|\s+\/\s+/).some(part => {
    const value = part.trim();
    if (/\bcanada\b/i.test(value) || canadianCountryCode.test(value)) return true;
    if (foreign.test(value) || foreignSuffix.test(value)) return false;
    return canada.test(value) || provinceCodes.test(value) || delimitedProvince.test(value) ||
      /^(?:ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|NT|NU|YT)$/.test(value) || cities.test(value);
  });
}

// Parse the entire range so "1–3 years" is not interpreted as a 3-year minimum.
function experienceMinimums(description: string): number[] {
  return [...description.matchAll(/\b(\d+)(?:\s*(?:[-–—]|to|[àa])\s*\d+)?\s*\+?\s*(?:years?|yrs?|ans?|ann[eé]es?)\s*(?:['’]\s*|(?:of|d['’])\s*)?(?:[\p{L}-]+\s+){0,4}(?:experience|exp[eé]rience)\b/giu)].map(m => Number(m[1]));
}
export type MechanicalAssessment = "matched" | "not_candidate" | "location" | "seniority_or_employment" | "discipline_evidence" | "experience" | "early_career_evidence";
export function assessMechanical(job: Job): MechanicalAssessment {
  if (!isMechanicalCandidate(job.title)) return "not_candidate";
  if (!job.locations.some(isCanadian)) return "location";
  if (hardExclusion.test(job.title) || levelTwo.test(job.title) || /\b(?:intermediate|s[eé]nior|talent pool|experienced|exp[eé]riment[eé]e?|confirm[eé]e?|technicien|technologist)\b/i.test(job.title) ||
      /\b(?:intern(?:ship)?|co[- ]?op|part[- ]?time|contract|temporary|freelance|stagiaire)\b/i.test((job.employmentType ?? "") + " " + job.title)) return "seniority_or_employment";
  const description = job.description ?? "";
  if (!mechanical.test(job.title) && !degree.test(description)) return "discipline_evidence";
  const minimums = experienceMinimums(description);
  if (minimums.some(years => years >= 3)) return "experience";
  if (job.isNewGrad === true || hasMechanicalEarlyTitle(job.title) ||
      /\b(?:new graduates?|recent graduates?|early[- ]career|entry[- ]level|aucune exp[eé]rience|nouveaux? dipl[oô]m[eé]s?)\b/i.test(description) ||
      minimums.some(years => years <= 2) ||
      /\b[01]\s*(?:[-–—]|to)\s*[12]\s+years?\b/i.test(description)) return "matched";
  return "early_career_evidence";
}

export type SweAssessment = "matched" | "location" | "seniority_or_employment" | "not_software" | "discipline_evidence" | "experience" | "early_career_evidence";

export function assessSwe(job: Job): SweAssessment {
  if (!job.locations.some(isCanadian)) return "location";
  if (hardExclusion.test(job.title) ||
      /\b(?:intern(?:ship)?|co[- ]?op|part[- ]?time|contract|temporary|freelance)\b/i.test(job.employmentType ?? "") ||
      /\b(?:part[- ]?time|contract|temporary)\b/i.test(job.title)) return "seniority_or_employment";
  const description = job.description ?? "";
  if (isMechanicalCandidate(job.title) && mechanical.test(job.title)) return "not_software";
  if (!isSweCandidateTitle(job.title)) return "not_software";
  // Generic QA, testing and analyst titles are not necessarily software work.
  // A technical description or an unambiguous software title is required.
  if (ambiguousSoftware.test(job.title) &&
      !software.test(job.title) && !relatedSoftware.test(job.title) && !softwareEvidence.test(description))
    return "discipline_evidence";
  if (ambiguousSoftware.test(job.title) && isMechanicalCandidate(job.title) &&
      degree.test(description) && !software.test(job.title) && !relatedSoftware.test(job.title))
    return "discipline_evidence";

  const minimums = experienceMinimums(description);
  const low = minimums.some(years => years <= 2);
  const high = minimums.some(years => years >= 3);
  const earlyTitle = early.test(job.title) || /^\s*graduate\b/i.test(job.title) ||
    /\b(?:graduate trainee|graduate program(?:me)?|campus (?:hire|graduate|undergraduate)|university hire|recent grad|jr\.?)\b/i.test(job.title);
  // Level II remains conditional: explicit early-career title OR credible
  // 0–2-year description evidence, not the curated feed flag alone.
  if (levelTwo.test(job.title)) {
    if (isMechanicalCandidate(job.title) && !software.test(job.title) && degree.test(description))
      return "discipline_evidence";
    if (high) return "experience";
    if (!earlyTitle && !low) return "early_career_evidence";
  }
  // A range is interpreted by its minimum, not its upper endpoint; plain
  // "2 years of experience" and "1–3 years" are legitimate early-career signals.
  if (high) return "experience";
  return job.isNewGrad === true || earlyTitle || low || descriptionEarly.test(description)
    ? "matched" : "early_career_evidence";
}

export function classifyJob(job: Job): JobCategory | undefined {
  // Preserve mechanical classification and routing precedence.
  if (!job.locations.some(isCanadian) || hardExclusion.test(job.title) ||
      /\b(?:intern(?:ship)?|co[- ]?op|part[- ]?time|contract|temporary|freelance)\b/i.test(job.employmentType ?? "") ||
      /\b(?:part[- ]?time|contract|temporary)\b/i.test(job.title)) return undefined;
  if (assessMechanical(job) === "matched") return "mechanical";
  return assessSwe(job) === "matched" ? "swe" : undefined;
}
export function eligible(job: Job): boolean { return classifyJob(job) !== undefined; }
