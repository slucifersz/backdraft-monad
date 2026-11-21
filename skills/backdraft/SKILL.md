---
name: backdraft
description: Use when writing or running code that sends transactions on Monad (scripts, bots, backends, agents). Monad charges the full gas limit and refunds nothing, so this skill makes you simulate first, set a tight limit, and route any unavoidable leftover gas through Backdraft so it does useful work and earns a bounty back.
---

# Backdraft

On Monad the fee is `gas_limit × gas_price`. Gas you reserve but do not use is paid for and discarded. The receipt's `gasUsed` equals the gas limit, so the explorer will not tell you what a call really used.

You, as an agent, have no wallet setting the gas limit for you. Do not hardcode a round number such as 300000 or 1000000.

## 1. Always simulate before sending

- Call `eth_estimateGas` for the exact call you are about to send.
- Set `gas = estimate × 1.075`. This is the buffer Category Labs measured for Monad; do not copy the 1.5× habit from other chains.
- A plain MON transfer to an account without code always costs 21000. Set it explicitly.
- If `eth_estimateGas` reverts, the call would fail. **Stop and report it.** Do not fall back to a large default limit: the whole limit is charged even when the transaction fails.

## 2. When a larger limit is unavoidable

Some calls cannot be estimated tightly (state moves between estimate and inclusion, or the path depends on other transactions). If you must leave more than about 90,000 gas of headroom, send the call through Backdraft so the leftover is spent on queued jobs and part of the fee comes back:

```bash
node scripts/backdraft.ts sim  --to <contract> --data <calldata> --gas <limit>
node scripts/backdraft.ts send --to <contract> --data <calldata> --gas <limit>
```

Both print one JSON object. Read `yourCallSucceeds`, `yourCallGas`, `recycledGas`, `bountyMon` and `recoveredShareOfFee`. Only send if the simulation says `yourCallSucceeds` is true, unless the user asked for the failing call to be sent anyway.

Do **not** use the wrapper when the target contract depends on who the caller is (token transfers from your own balance, approvals, anything checking `msg.sender`). Inside `exec` the caller is the Backdraft contract (`Afterburner`).

## 3. Never raise a limit to earn bounty

The bounty is capped below the gas price, so a bigger limit always costs more than it returns. Tight limits stay the cheapest option.

## Reference

- Backdraft core contract `Afterburner` (Monad Testnet, chainId 10143): `0xb22CA6B2090367F2487Caf0133Be3B2b18E7f607`
- `exec(address target, bytes data) returns (bool mainOk, uint256 mainGas, uint256 jobGas, uint256 units, uint256 bounty)`
- `Burned` event reports the real split of the gas limit: your call, recycled gas, gas still unused.
- Signing key: environment variable `BACKDRAFT_KEY`. Never print it.
