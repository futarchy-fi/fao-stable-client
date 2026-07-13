# FAO stable client

`fao.js` includes dependency-free canonical agent task, receipt, and payment builders, exact payment
binding to `TransferAction`, plus `AgentWorkIndex` publish calldata and log decoding. Accepted agent
payments are authorized, executable only while funded, and never partial; the index provides no
escrow or payment authority. Golden bytes live in `agent-document-golden.json`.

The dashboard accepts an explicit deployed index address, runtime hash, and start block. It
reconstructs task → receipt → payment lineage at one pinned block while keeping accepted,
executable-now, paid, and balance-proof-unverified states separate. Plans are calldata only: the
client neither treats the pinned CREATE2 prediction as deployed nor signs or sends transactions.

Out-of-band inspector for the FAO testnet deployment. This repository and its
deployment are deliberately outside the release authority of the FAO-governed
site.

`deployment.json` is the governed-site FAO/Sepolia deployment manifest. Until
the fresh FAO contracts are deployed it remains in `pre-deployment` state; the UI refuses
to invent or reuse legacy addresses. `flm-deployment.json` separately pins the
reviewed Gnosis factory and limited-funds canary used by `flm.html`.

`selfserve-deployment.json` is a separate trust root for permissionless Sepolia
FAO creation. Once deployed, it is the exact canonical registrar manifest: the
ownerless registrar plus the two shared compiler-pinned prerequisites. The FAO
dashboard never treats governed-site `deployment.json` as registrar authority.
`fao-creation-codes.json` contains the exact receipt, core, and FLM creation
blobs; the browser checks all twelve pinned Keccak hashes before using them.
Each FAO's separate schema-v3 economic manifest supplies its vault, gateway,
arbitration, and treasury executor. The treasury planner rechecks the executor
runtime hash and bidirectional on-chain wiring before sending any exact typed
transfer, bounded parameter, or two-round critical-action step.

The site is dependency-free static HTML, CSS, and JavaScript.

`flm.html` is the fixed Gnosis Chain surface for the reviewed permissionless
FLM factory and the reviewed limited-funds canary. It embeds the exact child
creation code built from `futarchy-liquidity-manager` commit `9d3f9cd` and
checks the factory's immutable dependencies and pinned hashes through the
connected wallet before enabling bundle creation. Factory events remain
unverified organization claims unless separately endorsed.

Run the manifest, ABI encoder, and embedded-bytecode checks with Foundry's `cast` available:

```sh
node --test test-*.mjs
```
