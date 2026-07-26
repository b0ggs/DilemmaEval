import { createHash } from "node:crypto";

export function stableStringify(value) {
  return JSON.stringify(sortForSerialization(value));
}

export function digest(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : stableStringify(value))
    .digest("hex");
}

function sortForSerialization(value) {
  if (Array.isArray(value)) {
    return value.map(sortForSerialization);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortForSerialization(value[key])])
    );
  }
  return value;
}
