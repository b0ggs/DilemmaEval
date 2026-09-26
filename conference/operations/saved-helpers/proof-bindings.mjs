import {
  configFingerprint,
  runtimeEvidenceFingerprint,
} from '../../../integration/conference-runner/src/readiness.mjs';

const DIGEST = /^[0-9a-f]{64}$/;

export function createProofBindings({ sourceConfig, preparedConfig, runtimeEvidence } = {}) {
  return Object.freeze({
    schema_version: 1,
    source_config_sha256: configFingerprint(sourceConfig),
    prepared_config_sha256: configFingerprint(preparedConfig),
    runtime_evidence_sha256: runtimeEvidenceFingerprint(runtimeEvidence),
  });
}

export function verifyProofBindings(bindings, values) {
  if (!bindings || bindings.schema_version !== 1 ||
      !DIGEST.test(bindings.source_config_sha256 ?? '') ||
      !DIGEST.test(bindings.prepared_config_sha256 ?? '') ||
      !DIGEST.test(bindings.runtime_evidence_sha256 ?? '')) {
    throw new Error('PROOF_BINDINGS_INVALID');
  }
  const expected = createProofBindings(values);
  for (const key of ['source_config_sha256', 'prepared_config_sha256', 'runtime_evidence_sha256']) {
    if (bindings[key] !== expected[key]) throw new Error('PROOF_BINDINGS_CHANGED');
  }
  return bindings;
}
