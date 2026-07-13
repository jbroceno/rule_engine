// api/utils/snapshot_integrity.js — single source of the HMAC canonicalization
// used for snapshot integrity (OWASP-10). Both createSnapshot (compute) and
// restoreSnapshot (verify) call these functions with the exact rulesJson/
// paramsJson strings persisted in dbo.cfg_config_snapshot — never a
// re-`JSON.stringify` of parsed objects — so the hash is byte-for-byte
// reproducible by construction.
//
// See openspec/changes/rbac-and-config-safeguards/design.md
//   § "HMAC canonicalization (fuente única — api/utils/snapshot_integrity.js)"
import crypto from "node:crypto";

const SEP = "\0"; // NUL — JSON.stringify never emits a literal NUL byte.

/** hex(64) HMAC-SHA256 over rulesJson + NUL + paramsJson (UTF-8). */
export function computeSnapshotChecksum(rulesJson, paramsJson, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${rulesJson ?? ""}${SEP}${paramsJson ?? ""}`, "utf8")
    .digest("hex");
}

/**
 * @param {{rulesJson: string, paramsJson: string, storedChecksum: string|null, secret: string}} params
 * @returns {{status: "verified"|"legacy"|"failed"}}
 */
export function verifySnapshotChecksum({ rulesJson, paramsJson, storedChecksum, secret }) {
  if (storedChecksum == null || storedChecksum === "") return { status: "legacy" };
  const recomputed = computeSnapshotChecksum(rulesJson, paramsJson, secret);
  const a = Buffer.from(recomputed, "hex");
  const b = Buffer.from(String(storedChecksum), "hex");
  if (a.length !== b.length) return { status: "failed" }; // guard: timingSafeEqual throws on length mismatch
  return { status: crypto.timingSafeEqual(a, b) ? "verified" : "failed" };
}
