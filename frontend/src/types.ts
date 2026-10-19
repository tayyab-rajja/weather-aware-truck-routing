export type RiskLevel = "low" | "moderate" | "high" | "severe" | "no_travel";

export interface Weather {
  wind_mph: number;
  rain_in_hr: number;
  snow_in_hr: number;
  temperature_f: number | null;
  observed_at: string;
}

export interface Checkpoint {
  mile: number;
  eta: string;
  lng: number;
  lat: number;
  weather: Weather;
  risk: RiskLevel;
  score: number;
  risk_reasons: string[];
}

export interface RouteMetrics {
  severe_miles: number;
  high_miles: number;
  no_travel_miles: number;
  avg_risk: number;
  travel_time_minutes: number;
  total_miles: number;
}

export interface RouteResult {
  id: string;
  summary: string;
  distance_miles: number;
  duration_minutes: number;
  geometry: [number, number][];
  checkpoints: Checkpoint[];
  metrics: RouteMetrics;
  is_recommended: boolean;
  recommendation_reason: string;
}

export interface HeatmapHour {
  hour_offset: number;
  score: number;
  risk: RiskLevel;
  time: string;
  wind_mph?: number;
}

export interface HeatmapPoint {
  lng: number;
  lat: number;
  mile: number;
  hours: HeatmapHour[];
}

export interface AnalyzeResponse {
  origin: { label: string; lng: number; lat: number };
  destination: { label: string; lng: number; lat: number };
  departure_at: string;
  load_weight_lb: number;
  sample_interval_miles: number;
  routes: RouteResult[];
  recommended_route_id: string | null;
  heatmap: {
    hours: number;
    start: string;
    points: HeatmapPoint[];
  };
}

export interface AnalyzeRequest {
  origin: string;
  destination: string;
  departure_at: string;
  load_weight_lb: number;
  sample_interval_miles: 10 | 25 | 50;
  origin_coords?: [number, number];
  destination_coords?: [number, number];
}

export interface PlaceSuggestion {
  label: string;
  lng: number;
  lat: number;
}
