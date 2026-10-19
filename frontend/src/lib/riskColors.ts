import type { RiskLevel } from "../types";

export const RISK_COLORS: Record<RiskLevel, string> = {
  low: "#2a9d8f",
  moderate: "#e9c46a",
  high: "#f4a261",
  severe: "#e76f51",
  no_travel: "#9b2226",
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  severe: "Severe",
  no_travel: "No Travel",
};
