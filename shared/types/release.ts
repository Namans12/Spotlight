export type MediaType = "movie" | "tv";
export type SectionKey = "hindi" | "english" | "popular";
export type WindowKind = "out_now" | "coming_up";

export interface ReleaseEvidenceDTO {
  region?: string;
  date_source?: string | null;
  provider_source?: string | null;
  observed_at?: string | null;
  date_precision?: string | null;
  event_kind?: string | null;
  source_url?: string | null;
  provider_types?: Record<string, string[]> | null;
}

export interface ReleaseItemDTO {
  tmdb_id: number;
  title: string;
  media_type: MediaType;
  language: string;
  release_date: string;
  rating: number | null;
  popularity: number;
  overview: string;
  tmdb_url: string;
  poster_url: string | null;
  providers: string[];
  evidence?: ReleaseEvidenceDTO | null;
}

export interface DigestWindow {
  start: string;
  end: string;
  sections: Record<SectionKey, ReleaseItemDTO[]>;
}

export interface DigestResponse {
  generated_at: string;
  region: string;
  out_now: DigestWindow;
  coming_up: DigestWindow;
}
