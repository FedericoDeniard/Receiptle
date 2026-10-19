import en from "./en.json";
import es from "./es.json";

export const strings = { es, en } satisfies Record<string, typeof es>;

export type Locale = keyof typeof strings;

/** Compile-time guard: the English copy must mirror the Spanish shape. */
export type LandingStrings = typeof es;

export function interpolate(
  template: string,
  values: Record<string, string | number>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  );
}
