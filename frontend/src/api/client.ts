import type { AnalyzeRequest, AnalyzeResponse, PlaceSuggestion } from "../types";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8000";

export async function analyzeRoutes(body: AnalyzeRequest): Promise<AnalyzeResponse> {
  const res = await fetch(`${API_URL}/api/analyze/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { detail?: string }).detail || `Request failed (${res.status})`);
  }
  return data as AnalyzeResponse;
}

export async function suggestPlaces(q: string): Promise<PlaceSuggestion[]> {
  if (!q.trim()) return [];
  const res = await fetch(`${API_URL}/api/geocode/?q=${encodeURIComponent(q)}`);
  const data = await res.json().catch(() => ({ results: [] }));
  if (!res.ok) return [];
  return (data as { results: PlaceSuggestion[] }).results || [];
}
