#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createSpectatorServer } from '../../../integration/conference-runner/src/server.mjs';
import { validateState } from '../../site/state.mjs';

const directory = process.env.PROOF_DIRECTORY;
if (!directory || !directory.startsWith('/')) throw new Error('PROOF_DIRECTORY_ABSOLUTE_REQUIRED');
const stateFile = `${directory}/public-state.json`;
const port = Number(process.env.PROOF_SITE_PORT ?? 8787);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PROOF_SITE_PORT_INVALID');
const state = validateState(JSON.parse(await readFile(stateFile, 'utf8')));
if (state.mode !== 'live' || state.status !== 'stopped' || state.current_game !== null) throw new Error('STOPPED_PUBLIC_PROOF_REQUIRED');
const savedState = { ...state, proof_label: 'Saved proof · read-only snapshot', proof_source: 'public-state.json' };
const getPublicState = () => savedState;
const server = createSpectatorServer({ getPublicState });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
console.log(`Saved proof spectator (read-only): http://127.0.0.1:${server.address().port}`);
const stop = () => server.close(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
