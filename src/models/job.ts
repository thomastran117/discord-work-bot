export type JobCategory = "swe" | "mechanical";

export interface Job {
  category?: JobCategory;
  source: string;
  externalId: string;
  title: string;
  company: string;
  locations: string[];
  url: string;
  description?: string;
  employmentType?: string;
  isNewGrad?: boolean;
  postedAt?: string;
  startDate?: string;
  requisitionKey?: string;
}

export interface JobSource {
  name: string;
  fetchJobs(): Promise<Job[]>;
}

export interface BoardConfig {
  provider: "greenhouse" | "lever" | "ashby";
  company: string;
  board: string;
  region?: "global" | "eu";
  mechanicalFocus?: boolean;
}
