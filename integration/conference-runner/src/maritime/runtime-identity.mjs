export const HERMES_RUNTIME_IDENTITY = Object.freeze({ uid: 10_000, gid: 10_000 });

/** Returns the only supported non-root runtime identity, or null for OpenClaw. */
export function runtimeIdentityForSettings(settings) {
  if (settings?.harness === 'openclaw') {
    if (settings.runtime_identity !== undefined) throw new TypeError('MARITIME_RUNTIME_IDENTITY_INVALID');
    return null;
  }
  if (settings?.harness !== 'hermes') throw new TypeError('MARITIME_RUNTIME_IDENTITY_INVALID');
  const identity = settings.runtime_identity;
  if (!identity || Object.keys(identity).sort().join(',') !== 'gid,uid' ||
      identity.uid !== HERMES_RUNTIME_IDENTITY.uid || identity.gid !== HERMES_RUNTIME_IDENTITY.gid) {
    throw new TypeError('MARITIME_RUNTIME_IDENTITY_INVALID');
  }
  return HERMES_RUNTIME_IDENTITY;
}
