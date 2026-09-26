if(process.env.PROOF_EXPECTED_SEATS!==undefined||process.env.PROOF_MAX_AWAKE!==undefined)throw new Error('TEN_SEAT_CAPACITY_OVERRIDE_REJECTED');
process.env.PROOF_EXPECTED_SEATS='10';
process.env.PROOF_MAX_AWAKE='5';
await import('./controlled-proof.mjs');
