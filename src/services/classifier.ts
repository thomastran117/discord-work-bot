import type { Job, JobCategory } from "../models/job.ts";

const canada = /\b(canada|ontario|qu[eé]bec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|prince edward island|northwest territories|nunavut|yukon)\b/i;
const cities = /\b(toronto|waterloo|kitchener|ottawa|vancouver|montr[eé]al|calgary|edmonton|burnaby|markham|mississauga|victoria|halifax|winnipeg|saskatoon|regina|kanata|gatineau|qu[eé]bec city|laval|richmond hill|surrey|fredericton|oakville|burlington|kelowna|guelph)\b/i;
const provinceCodes = /(?:,\s*|\(\s*)(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|NT|NU|YT)(?=$|[\s,)])/i;
const foreign = /\b(united states|usa|u\.s\.|california|washington|texas|new york|united kingdom|uk|australia|india)\b|,\s*(CA|WA|NY|TX|OR|MI|MA|OH|FL|IL|CO|VA|PA|NJ|MD|WI|MN|IN|NC|SC|GA|AZ|NV|CT|TN|MO|IA|ID|UT|NM|KS|OK|AR|LA|MS|AL|KY|NE|ND|SD|MT|WY|WV|VT|NH|ME|RI|DE|HI|AK)(?=$|[,\s)])/i;
const role = /\b(?:software|backend|back[- ]end|frontend|front[- ]end|full[- ]stack|embedded|firmware|devops|sre|site reliability|platform|infrastructure|cloud|machine learning|data|security|distributed systems|systems|application|mobile|android|ios)\b.{0,35}\b(?:engineer(?:ing)?|developer|programmer)\b|\b(?:software developer|software engineer|swe|sde|devops|sre|développeur|développeuse|programmeur|ingénieur logiciel)\b/i;
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
const exclusion = /\b(?:senior|staff|principal|manager|director|intern(?:ship)?|co[- ]?op|sr|lead|stagiaire|(?:engineer|developer|sde|swe)\s+(?:ii|iii|iv|2|3|4)|mid[- ]level)\b/i;
const descriptionEarly = /\b(?:new graduates?|recent graduates?|early[- ]career|entry[- ]level|[01]\s*(?:[-–—]|to)\s*[12]\s+years?|[01]\+?\s+years?\s+(?:of\s+)?(?:professional|relevant|software|work)\s+experience)\b/i;
const experienceHigh = /\b(?:[3-9]|[1-9]\d)\+?\s+years?\s+(?:of\s+)?(?:professional|relevant|software|work|industry)\s+experience\b/i;

export function isCanadian(location: string): boolean {
  if (canada.test(location) || provinceCodes.test(location)) return true;
  return !foreign.test(location) && cities.test(location);
}

// Parse the entire range so "1–3 years" is not interpreted as a 3-year minimum.
function experienceMinimums(description: string): number[] {
  return [...description.matchAll(/\b(\d+)(?:\s*(?:[-–—]|to|[àa])\s*\d+)?\s*\+?\s*(?:years?|yrs?|ans?|ann[eé]es?)\s*(?:['’]\s*|(?:of|d['’])\s*)?(?:[\p{L}-]+\s+){0,4}(?:experience|exp[eé]rience)\b/giu)].map(m => Number(m[1]));
}
export type MechanicalAssessment = "matched" | "not_candidate" | "location" | "seniority_or_employment" | "discipline_evidence" | "experience" | "early_career_evidence";
export function assessMechanical(job: Job): MechanicalAssessment {
  if (!isMechanicalCandidate(job.title)) return "not_candidate";
  if (!job.locations.some(isCanadian)) return "location";
  if (exclusion.test(job.title) || /\b(?:intermediate|s[eé]nior|talent pool|experienced|exp[eé]riment[eé]e?|confirm[eé]e?|technicien|technologist)\b/i.test(job.title) ||
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

export function classifyJob(job: Job): JobCategory | undefined {
  if (!job.locations.some(isCanadian) || exclusion.test(job.title)) return undefined;
  if (/\b(?:intern(?:ship)?|co[- ]?op|part[- ]?time|contract|temporary|freelance)\b/i.test(job.employmentType ?? "")) return undefined;
  if (/\b(?:part[- ]time|contract|temporary)\b/i.test(job.title)) return undefined;
  const description = job.description ?? "";
  const mechanicalAssessment = assessMechanical(job);
  if (mechanicalAssessment === "matched") return "mechanical";
  // Explicit mechanical titles must never fall through into the SWE channel.
  if (isMechanicalCandidate(job.title) && mechanical.test(job.title)) return undefined;
  if (!role.test(job.title)) return undefined;
  return job.isNewGrad === true || early.test(job.title) ||
    (descriptionEarly.test(description) && !experienceHigh.test(description)) ? "swe" : undefined;
}
export function eligible(job: Job): boolean { return classifyJob(job) !== undefined; }
