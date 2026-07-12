# FAO stable client

Out-of-band inspector for the FAO testnet deployment. This repository and its
deployment are deliberately outside the release authority of the FAO-governed
site.

`deployment.json` is the only FAO/Sepolia deployment manifest. Until the fresh
FAO contracts are deployed it remains in `pre-deployment` state; the UI refuses
to invent or reuse legacy addresses. `flm-deployment.json` separately pins the
reviewed Gnosis factory and limited-funds canary used by `flm.html`.

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
