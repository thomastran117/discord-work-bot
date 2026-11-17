import type { Job } from "../models/job.ts";

const month = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const term = "(?:Winter|Spring|Summer|Fall|Autumn)";
const date = "(?:20\\d{2}-\\d{2}-\\d{2}|" + month + "\\.?\\s+\\d{1,2},?\\s+20\\d{2}|" + month + "\\.?\\s+20\\d{2}|" + term + "\\s+20\\d{2}|20\\d{2})";
const patterns = [
  new RegExp("\\b(?:start(?:ing)?\\s+date|start\\s+term|starting\\s+(?:in|on)|starts?\\s+(?:in|on)|commenc(?:es|ing)\\s+(?:in|on))\\s*[:–—-]?\\s*(" + date + ")\\b", "i"),
  new RegExp("\\b(" + date + ")\\s+(?:start(?:\\s+date)?|intake)\\b", "i")
];

export function extractStartDate(job: Job): string | undefined {
  if (job.startDate?.trim()) return job.startDate.trim();
  for (const text of [job.title, job.description ?? ""]) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }
    if (/\b(?:flexible start date|start date (?:is )?flexible)\b/i.test(text)) return "Flexible";
  }
  return undefined;
}
