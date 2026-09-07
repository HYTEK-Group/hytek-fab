// Which job, if any, is this Y: drive folder for?
//
// Extracted from ss-ingest-bridge.mjs so it can be tested, because the version
// that lived inline invented job numbers:
//
//   const m = jobDir.match(/\b(HG\d{6,})\b/i)
//   jobs.push({ jobNo: m ? m[1].toUpperCase() : jobDir, ... })
//
// The `: jobDir` is the bug. A folder named "26070101 - Smith Road" produced the
// job number `26070101 - Smith Road`, and the bridge then upserted a fab_jobs
// row under it with the service-role key. Every folder in the tree that had an
// assembly list minted a job, whatever it was called. Only the Hub issues job
// numbers (CLAUDE.md rule 1).
//
// It also only ever looked for HG. The mint has issued 8-digit YYMMDDNN numbers
// for months, so the modern folders were exactly the ones that fell through to
// the folder-name branch.
//
// A folder we cannot read a number from is now SKIPPED and logged. That is a
// data question for the Monday review, not something the bridge guesses at.

/**
 * The job reference in a folder name, or null.
 *
 * Order matters: 8-digit first, because a folder can carry both (a job renamed
 * from its legacy number keeps the old one in the title) and the 8-digit one is
 * the current mint. An HG/HM reference is returned as-is and resolved against
 * the Hub's alias table by POST /api/fab/jobs — the bridge never decides what a
 * legacy number means.
 *
 * @param {string} folderName
 * @returns {string | null}
 */
export function jobRefFromFolder(folderName) {
  if (typeof folderName !== 'string') return null
  const name = folderName.trim()
  if (!name) return null

  // YYMMDDNN. Bounded on both sides so "260701012" and a date like 26.07.2026
  // do not produce a false 8-digit run.
  const m8 = name.match(/(?<!\d)(\d{8})(?!\d)/)
  if (m8) return m8[1]

  const mLegacy = name.match(/\b((?:HG|HM)\d{6,})\b/i)
  if (mLegacy) return mLegacy[1].toUpperCase()

  return null
}

/**
 * The human name of the job, with the reference stripped off the front.
 * Falls back to the whole folder name when there is nothing left.
 *
 * @param {string} folderName
 * @returns {string}
 */
export function jobNameFromFolder(folderName) {
  const ref = jobRefFromFolder(folderName)
  if (!ref) return folderName
  const stripped = folderName
    .replace(new RegExp(`^\\s*${ref}\\s*[-–—_]?\\s*`, 'i'), '')
    .trim()
  return stripped || folderName
}
