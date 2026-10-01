// How a job is NAMED for a person to read, everywhere in fab:
//   "26093002 · Coral LAGOS 263Q — Lot 621, 20 Sagebrush Street"
// The job number always comes first (Scott, 01/10/2026 — the same in every
// HYTEK app and the Hub). No number known → the name alone; never invent one.
// Display only: never use this for stored values, URLs, file names or payloads.
export function jobLabel(number: string | null | undefined, name: string | null | undefined): string {
  const n = (number ?? '').trim()
  const nm = (name ?? '').trim()
  if (n && nm) return `${n} · ${nm}`
  return n || nm
}
