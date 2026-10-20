import type { AnalyzeRequest, AnalyzeResponse, PlaceSuggestion } from "../types";

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

export async function analyzeRoutes(body: AnalyzeRequest): Promise<AnalyzeResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/analyze/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Cannot reach API. Is the backend running on port 8000?");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { detail?: string }).detail || `Request failed (${res.status})`);
  }
  return data as AnalyzeResponse;
}

export async function suggestPlaces(
  q: string,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  if (!q.trim()) return [];
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/geocode/?q=${encodeURIComponent(q)}`, { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    return [];
  }
  const data = await res.json().catch(() => ({ results: [] }));
  if (!res.ok) return [];
  return (data as { results: PlaceSuggestion[] }).results || [];
}
