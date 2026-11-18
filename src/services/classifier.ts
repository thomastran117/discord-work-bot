import type { Job, JobCategory } from "../models/job.ts";

const canada = /\b(canada|ontario|qu[eé]bec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|prince edward island|northwest territories|nunavut|yukon)\b/i;
const cities = /\b(toronto|waterloo|kitchener|ottawa|vancouver|montr[eé]al|calgary|edmonton|burnaby|markham|mississauga|victoria|halifax|winnipeg|saskatoon|regina|kanata|gatineau|qu[eé]bec city|laval|richmond hill|surrey|fredericton|oakville|burlington|kelowna|guelph)\b/i;
const provinceCodes = /(?:,\s*|\(\s*)(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|NT|NU|YT)(?=$|[\s,)])/i;
const foreign = /\b(united states|usa|u\.s\.|california|washington|texas|new york|united kingdom|uk|australia|india)\b|,\s*(CA|WA|NY|TX|OR|MI|MA|OH|FL|IL|CO|VA|PA|NJ|MD|WI|MN|IN|NC|SC|GA|AZ|NV|CT|TN|MO|IA|ID|UT|NM|KS|OK|AR|LA|MS|AL|KY|NE|ND|SD|MT|WY|WV|VT|NH|ME|RI|DE|HI|AK)(?=$|[,\s)])/i;
const role = /\b(?:software|backend|back[- ]end|frontend|front[- ]end|full[- ]stack|embedded|firmware|devops|sre|site reliability|platform|infrastructure|cloud|machine learning|data|security|distributed systems|systems|application|mobile|android|ios)\b.{0,35}\b(?:engineer(?:ing)?|developer|programmer)\b|\b(?:software developer|software engineer|swe|sde|devops|sre|développeur|développeuse|programmeur|ingénieur logiciel)\b/i;
const mechanical = /\b(?:mechanical|mechatronics|manufacturing|industrial|automotive|aerospace|thermal|hvac|tooling|m[eé]canique)\b/i;
const adjacent = /\b(?:robotics|product design|process|quality|controls?|test|validation|maintenance|stress)\b/i;
const engineering = /\b(?:engineer(?:ing)?|designer|eit|ing[eé]nieur(?:e)?|g[eé]nie|cpi)\b/i;
const software = /\b(?:software|firmware|swe|sde|developer|programmer|logiciel|devops|sre)\b/i;
const degree = /\b(?:mechanical|mechatronics|manufacturing|aerospace|industrial) engineering\b|g[eé]nie m[eé]canique/i;
export function isMechanicalCandidate(title: string): boolean {
  return !software.test(title) && engineering.test(title) && (mechanical.test(title) || adjacent.test(title));
}
const early = /\b(?:new[- ]grad(?:uate)?|recent graduate|university graduate|early[- ]career|entry[- ]level|junior|graduate (?:program|engineer|developer)|associate (?:software|engineer|developer)|(?:engineer|developer|programmer|sde|swe)\s+(?:i|1)|early in career|graduate software)\b|nouveau[x]? diplômé|débutant/i;
const exclusion = /\b(?:senior|staff|principal|manager|director|intern(?:ship)?|co[- ]?op|sr|lead|stagiaire|(?:engineer|developer|sde|swe)\s+(?:ii|iii|iv|2|3|4)|mid[- ]level)\b/i;
const descriptionEarly = /\b(?:new graduates?|recent graduates?|early[- ]career|entry[- ]level|[01]\s*(?:[-–—]|to)\s*[12]\s+years?|[01]\+?\s+years?\s+(?:of\s+)?(?:professional|relevant|software|work)\s+experience)\b/i;
const experienceHigh = /\b(?:[3-9]|[1-9]\d)\+?\s+years?\s+(?:of\s+)?(?:professional|relevant|software|work|industry)\s+experience\b/i;

export function isCanadian(location: string): boolean {
  if (canada.test(location) || provinceCodes.test(location)) return true;
  return !foreign.test(location) && cities.test(location);
}

export function classifyJob(job: Job): JobCategory | undefined {
  if (!job.locations.some(isCanadian) || exclusion.test(job.title)) return undefined;
  if (/\b(?:intern(?:ship)?|co[- ]?op|part[- ]?time|contract|temporary|freelance)\b/i.test(job.employmentType ?? "")) return undefined;
  if (/\b(?:part[- ]time|contract|temporary)\b/i.test(job.title)) return undefined;
  const description = job.description ?? "";
  if (isMechanicalCandidate(job.title) && (mechanical.test(job.title) || degree.test(description))) {
    if (experienceHigh.test(description) || /\b(?:[3-9]|[1-9]\d)\+?\s+years?\s+(?:of\s+)?(?:[\w-]+\s+){0,4}experience\b/i.test(description)) return undefined;
    return job.isNewGrad === true || early.test(job.title) ||
      /\b(?:eit|engineer[- ]in[- ]training|engineering graduate|graduate engineer|cpi|jr\.?)\b/i.test(job.title) ||
      descriptionEarly.test(description) || /\b(?:[01]\s*(?:[-–—]|to)\s*[12]|[012])\+?\s+years?\s+(?:of\s+)?(?:engineering\s+)?experience\b/i.test(description) ? "mechanical" : undefined;
  }
  if (!role.test(job.title)) return undefined;
  return job.isNewGrad === true || early.test(job.title) ||
    (descriptionEarly.test(description) && !experienceHigh.test(description)) ? "swe" : undefined;
}
export function eligible(job: Job): boolean { return classifyJob(job) !== undefined; }
