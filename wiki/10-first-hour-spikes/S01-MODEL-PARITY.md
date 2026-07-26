# S01 — Model parity

- **Status:** Not started
- **Purpose:** Prove OpenClaw and Hermes reach the same model through the Maritime proxy with the same effective settings.
- **Accountable owner:** Fairness lead — unassigned
- **Evidence reviewer:** Independent harness reviewer — unassigned
- **Classification:** HARD FAIRNESS GATE; model/route locked by final addendum
- **Navigation:** Previous: [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md) · [Wiki home](../README.md) · [MASTER](../MASTER-IMPLEMENTATION-GUIDE.md) · Next: [S02](S02-SELF-SIGNING.md)

## Read first

- [ ] [M01](../00-start-here/M01-RUN-CONFIGURATION.md) `CFG-MODEL`, `CFG-MODEL-ROUTE`, and `CFG-MODEL-SETTINGS`; [M03](../00-start-here/M03-SECURITY-AND-SECRETS.md) handoff.
- [ ] Decision sheet [§2.4](../../prisoners-daolemma-tournament-decisions-v1_0.md#24-model) and [§4.1](../../prisoners-daolemma-tournament-decisions-v1_0.md#4-first-hour-spikes).

## Inputs and prerequisites

| Input | Classification | Requirement | Source/freshness |
|---|---|---|---|
| Exact model | LOCKED / LIVE-VERIFY | Primary `gpt-5.4-mini`; fallback `gpt-4o` only if the proxy does not serve the primary cleanly | Query the Maritime proxy models endpoint, then freeze |
| Provider route | LOCKED / LIVE-VERIFY | Both harnesses use `https://api.maritime.sh/api/llm/v1`; native `api.openai.com` is excluded | Inspect effective config/runtime |
| Harness route context | LOCKED recipe / LIVE-VERIFY | Hermes keeps the Maritime proxy base URL and sets the locked model; OpenClaw uses a custom OpenAI-compatible provider at the same URL | Inspect both current effective routes |
| Settings | LOCKED equality / RUN-FROZEN | Same prompt, available tools, reasoning/sampling parameters, limits, retries/timeouts, and other request-affecting settings | Record redacted effective values |
| Probe | Test input | Equivalent bounded request under current API authorization | Hash/freeze before both runs |

## Execution checklist

- [ ] `S01-01` Record the selected exact model identifier and all parity-sensitive settings.
- [ ] `S01-02` Capture redacted effective OpenClaw provider, route, model, and settings.
- [ ] `S01-03` Capture the current redacted effective Hermes and OpenClaw provider, proxy endpoint, model, and settings; prove both use the same Maritime proxy path and neither uses native `api.openai.com`.
- [ ] `S01-04` Run equivalent authorized probes and record timestamps plus non-secret request/response metadata.
- [ ] `S01-05` Compare every field and enumerate all differences.
- [ ] `S01-06` Mark `Passed` only if model, route, and effective settings match; otherwise mark `Failed` or `Blocked`.

## Acceptance and evidence

| Checklist | Objective pass condition | Evidence |
|---|---|---|
| S01-01 | One exact frozen comparison matrix exists | Config digest/matrix |
| S01-02–S01-03 | Current runtime evidence shows both effective paths independently resolve to the same Maritime proxy endpoint/model/settings | Redacted configuration/runtime evidence |
| S01-04 | Inputs and parity-sensitive conditions are equivalent | Paired probe records |
| S01-05–S01-06 | Independent reviewer finds no unexplained parity-sensitive difference | Difference report and signed verdict |

## Stop and escalate

- **If this spike fails or is indeterminate, there is no tournament. Stop all later spikes/build/scale work that assumes fairness.**
- Stop on unmatched intermediaries, model access, model identifier, settings, tool surface, or hidden defaults; a matching display name is insufficient.
- Escalate selection questions to the tournament lead and effective-route discrepancies to both harness owners.
- Safe state: retain redacted comparison evidence, revise the OPEN selection/config, and rerun S01 from the start.

## Handoff and next

Record verdict, exact comparison fields, evidence, and every difference. Only on `Passed`, continue to [S02 Self-signing](S02-SELF-SIGNING.md). Minimum context: MASTER, S02, S01 handoff, relevant M01 resource rows, and M03.

## Source and canon

- [§2.4 Model](../../prisoners-daolemma-tournament-decisions-v1_0.md#24-model)
- [§4.1 Model parity spike](../../prisoners-daolemma-tournament-decisions-v1_0.md#4-first-hour-spikes)
- [Final addendum §2 Model and route parity](../../prisoners-daolemma-plan-review-addendum-final.md#2-model-and-route-parity)
