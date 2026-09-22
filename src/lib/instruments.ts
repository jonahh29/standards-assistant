// Shared across the upload form, the documents list, and (from step 3/4 onward)
// retrieval scoping and citation display — one place defining what instrument/
// council values exist, so every part of the app agrees with the database's own
// check constraints (see the migration in Step 1).

export type Instrument = "ncc" | "qdc" | "qld_housing_code" | "council_scheme";
export type Council = "brisbane" | "gold_coast" | "sunshine_coast";

export const INSTRUMENT_LABELS: Record<Instrument, string> = {
  ncc: "NCC",
  qdc: "Queensland Development Code",
  qld_housing_code: "Queensland Housing Code",
  council_scheme: "Council planning scheme",
};

export const COUNCIL_LABELS: Record<Council, string> = {
  brisbane: "Brisbane City Plan",
  gold_coast: "Gold Coast City Plan",
  sunshine_coast: "Sunshine Coast Planning Scheme",
};

export function isInstrument(value: unknown): value is Instrument {
  return typeof value === "string" && value in INSTRUMENT_LABELS;
}

export function isCouncil(value: unknown): value is Council {
  return typeof value === "string" && value in COUNCIL_LABELS;
}

/** A short label for a document given its instrument (and council, if it's a
 * council_scheme document) — e.g. "NCC", "Queensland Development Code", or
 * "Gold Coast City Plan" (the specific scheme name reads better than the generic
 * "Council planning scheme" once we know which council). */
export function instrumentDisplayLabel(instrument: Instrument, council: Council | null): string {
  if (instrument === "council_scheme" && council) return COUNCIL_LABELS[council];
  return INSTRUMENT_LABELS[instrument];
}
