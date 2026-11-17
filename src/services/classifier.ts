import type { Job } from "../models/job.ts";

const canada = /\b(canada|ontario|qu[eé]bec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|prince edward island|northwest territories|nunavut|yukon)\b/i;
const cities = /\b(toronto|waterloo|kitchener|ottawa|vancouver|montr[eé]al|calgary|edmonton|burnaby|markham|mississauga|victoria|halifax|winnipeg|saskatoon|regina|kanata|gatineau|qu[eé]bec city|laval|richmond hill|surrey|fredericton|oakville|burlington|kelowna|guelph)\b/i;
const provinceCodes = /(?:,\s*|\(\s*)(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|NT|NU|YT)(?=$|[\s,)])/i;
const foreign = /\b(united states|usa|u\.s\.|california|washington|texas|new york|united kingdom|uk|australia|india)\b|,\s*(CA|WA|NY|TX|OR|MI|MA|OH|FL|IL|CO|VA|PA|NJ|MD|WI|MN|IN|NC|SC|GA|AZ|NV|CT|TN|MO|IA|ID|UT|NM|KS|OK|AR|LA|MS|AL|KY|NE|ND|SD|MT|WY|WV|VT|NH|ME|RI|DE|HI|AK)(?=$|[,\s)])/i;
const role = /\b(?:software|backend|back[- ]end|frontend|front[- ]end|full[- ]stack|embedded|firmware|devops|sre|site reliability|platform|infrastructure|cloud|machine learning|data|security|distributed systems|systems|application|mobile|android|ios)\b.{0,35}\b(?:engineer(?:ing)?|developer|programmer)\b|\b(?:software developer|software engineer|swe|devops|sre|développeur|développeuse|programmeur|ingénieur logiciel)\b/i;
const early = /\b(?:new[- ]grad(?:uate)?|recent graduate|university graduate|early[- ]career|entry[- ]level|junior|graduate (?:program|engineer|developer)|associate (?:software|engineer|developer)|(?:engineer|developer|programmer)\s+(?:i|1))\b|nouveau[x]? diplômé|débutant/i;
const exclusion = /\b(?:senior|staff|principal|manager|director|intern(?:ship)?|co[- ]?op|sr|lead|stagiaire|engineer\s+(?:ii|iii|iv|2|3|4))\b/i;
const descriptionEarly = /\b(?:new graduates?|recent graduates?|early[- ]career|entry[- ]level|0\s*(?:[-–—]|to)\s*[12]\s+years?|[01]\+?\s+years?\s+(?:of\s+)?(?:professional|relevant|software|work)\s+experience)\b/i;
const experienceHigh = /\b(?:[3-9]|[1-9]\d)\+?\s+years?\s+(?:of\s+)?(?:professional|relevant|software|work|industry)\s+experience\b/i;

export function isCanadian(location: string): boolean {
  if (canada.test(location) || provinceCodes.test(location)) return true;
  return !foreign.test(location) && cities.test(location);
}

export function eligible(job: Job): boolean {
  if (!job.locations.some(isCanadian) || !role.test(job.title) || exclusion.test(job.title)) return false;
  if (/\b(?:intern(?:ship)?|co[- ]?op|part[- ]?time|contract|temporary|freelance)\b/i.test(job.employmentType ?? "")) return false;
  if (/\b(?:part[- ]time|contract|temporary)\b/i.test(job.title)) return false;
  return job.isNewGrad === true || early.test(job.title) ||
    (descriptionEarly.test(job.description ?? "") && !experienceHigh.test(job.description ?? ""));
}
