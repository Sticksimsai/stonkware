# Hypeware on Hyperliquid: migration plan

**Status:** Phases 1 (foundation) and 2 (treasury bridge, behind `HL_BRIDGE`) built; Phases 3–5 not started.
**Decision so far:** tokens keep launching on **Solana** (StonkFun). Hyperliquid becomes the **tech chain**: the treasury, agent trading, customer payments and platform contracts move there.

```
 Solana (token side)                         Hyperliquid (tech side)
 ───────────────────                         ───────────────────────────────────────────
 $TOKEN on StonkFun ─creator fees (SOL)─▶ Solana treasury ─sweep─▶ Unit ─▶ uSOL ─sell─▶ USDC treasury (HyperCore)
        ▲                                                                                  │
        └──── buyback: USDC ─▶ uSOL ─▶ Unit withdraw ─▶ SOL ─▶ Jupiter buy ◀──────────────┤
                                                                                           ├─▶ agent trades spot/perps (API wallet, risk limits)
 customers ─USDC/HYPE on HyperEVM─▶ company EVM address ─▶ HyperCore ─────────────────────┤
                                                                                           └─▶ compute + platform cut (usdSend) ─▶ FeeSplitter (HyperEVM) ─▶ flagship share
```

## What stays the same

- Launches, dev buys, curve/graduation tracking and creator-fee claims: still `venue.ts` / `stonkfun.ts` / `launchlab.ts` on Solana.
- The creator's identity is still their Solana launch wallet (it signs bot connections and creator actions).
- Each company still has a sealed Solana treasury key, but it becomes a **pass-through**: it collects fees and keeps a small SOL float for gas and buybacks.

## What changes

| Area | Today | After |
|---|---|---|
| Company keys | 1 Solana keypair | + 1 EVM keypair (same address on HyperCore and HyperEVM), + 1 Hyperliquid **API wallet** that can trade but **cannot withdraw** |
| Treasury unit | lamports (102 refs in `src/`) | USDC micro-units, with a `currency` column on money rows. SOL stays only on Solana-side rows. |
| Agent spends | SOL transfers, buyback & burn | USDC `usdSend`, Hyperliquid spot/perp orders, buyback via the bridge |
| Customer payments | SOL to the treasury, checked by `verifyDeposit` | USDC or HYPE on HyperEVM to the company's EVM address, checked from the receipt or Transfer log |
| Compute billing | SOL repaid to `PLATFORM_FEE_WALLET` | USDC repaid on HyperCore (`usdSend`, instant, no gas) |
| Platform revenue / flagship | SOL credited in DB + transfers | `FeeSplitter` contract on HyperEVM pays the flagship share on-chain |
| Wallet UI | Solana wallet adapter | Solana adapter kept for launch; **wagmi + viem** added (HyperEVM chain 999, testnet 998) for payments |

## Phases

Each phase is its own PR, works in `FIRMWARE_MODE="mock"`, and runs on the **Hyperliquid testnet** before mainnet. Each phase can ship on its own.

### Phase 1: Hyperliquid foundation
- `src/lib/hl/`: client for the `info` and `exchange` endpoints. Proposed SDK: `@nktkas/hyperliquid`, with signing via `viem` (check its maintenance status before adopting). Handles the two signing schemes (user-signed EIP-712 and L1 "phantom agent"), nonces and testnet/mainnet switching.
- `newSealedEvmKey()` next to `newSealedKeypair()`, sealed with `VAULT_KEY`. At launch, approve a named API wallet per company.
- Schema: `hlAddress`, `hlSecretEnc`, `hlAgentSecretEnc`, `unitDepositAddress`. A backfill script for existing companies.
- **Signer policy for Hyperliquid:** everything goes through one `hlSign(intent)`, mirroring `signer.ts`. Withdrawals and transfers out need the master key and an intent check. Orders use only the API wallet.
- Company page and `/api/companies/:slug` show the USDC treasury.

### Phase 2: Treasury bridge (Solana fees → USDC on Hyperliquid)

> **Built.** Off until `HL_BRIDGE=on`. Notes from building it:
> - Unit signs `<node>:user-<coinType>-<dstChain>-<dstAddr>-<address>` with EVM addresses checksummed. Its docs show an older format that no longer verifies. Addresses need 2 of 3 guardian keys and are re-checked before every use.
> - Unit's testnet is Solana **devnet** ⇄ Hyperliquid testnet, so the bridge refuses to run unless `HL_NETWORK` matches `SOLANA_CLUSTER`.
> - The testnet USOL/USDC book is far off the SOL price (≈$14 vs ≈$110 on 2026-10-29). Conversions are capped at `HL_MAX_SLIPPAGE_BPS` from Hyperliquid's SOL perp mid, so on testnet they won't fill unless you raise it.
> - Accounting stays in lamports for now: the treasury balance = Solana + Hyperliquid (USDC at the SOL price, uSOL 1:1, in-flight transfers). Moving the ledger to USD is still to do.
- After `claimCreatorFees`, sweep SOL above a float (e.g. 0.3 SOL) to the company's Unit deposit address. Unit's minimum is **0.12 SOL** and the network cost is about **$1.30**, so sweeps are batched (default threshold 0.5 SOL).
- On arrival: sell uSOL for USDC on Hyperliquid spot. Record `BRIDGE_IN` and `SWAP` ledger rows.
- Reverse path for buybacks: USDC → uSOL → Unit withdraw to the Solana treasury → existing `buyOwnToken`.
- Recovery: detect stuck sweeps (sent, not credited after N minutes) in `recovery.ts`.
- Move `chargeCompute` / `settleCompute` and the agent's balance checks to the USDC treasury.

### Phase 3: Agent trading tools
- Tools: `hl_markets`, `hl_positions`, `hl_order` (spot/perp, limit/market/IOC), `hl_cancel`, `hl_close`.
- **Risk limits enforced server-side**, not in the prompt. Proposed defaults, each set by an env var:
  - max leverage **3×**
  - max margin in use **25%** of the treasury
  - max size per order **10%** of the treasury
  - daily realised-loss stop **10%** (trading pauses until the next UTC day)
  - an optional allowed-markets list
- The API wallet can't withdraw. A compromised agent prompt can lose money on trades but can't drain funds.
- Every order and fill goes into the feed and ledger, so it shows up live.

### Phase 4: Customer payments in USDC / HYPE
- `create_offer` prices in USD. Checkout pays to the company's EVM address on HyperEVM, in USDC (ERC-20) or HYPE (native, priced at the current mid).
- `orders/[id]/confirm` verifies from a HyperEVM receipt (Transfer log or value, confirmations, recipient, amount). This replaces `verifyDeposit`.
- Received funds move to HyperCore (USDC via Circle's `CoreDepositWallet`, HYPE via `0x2222…2222`) so the agent can use them.
- The frontend `BuyOffer` gets an EVM wallet connect. SOL checkout stays during the transition, behind a flag.

### Phase 5: Platform contracts on HyperEVM
- `contracts/` (Foundry): `FeeSplitter` takes platform revenue and pays out `FLAGSHIP_SHARE_PCT` to the flagship treasury and the rest to the platform. It's owner-configurable with a timelock on changes. An optional `Receipts` registry logs revenue events for public proof.
- Deploy to the HyperEVM testnet first. **External audit before mainnet**, because these contracts hold platform money.
- `flagship.ts` / `creditFlagship` read on-chain balances instead of DB-only credit.

## Risks and open questions

1. **Bridge dependency:** SOL moves to Hyperliquid through Unit (a guardian network). If Unit is down, fees wait on Solana. The fallback is to keep them in SOL and retry.
2. **Perp trading with company money** is the biggest new risk. The limits above are a starting point; please confirm them.
3. **SDK and API details** to verify against current docs during Phase 1: chain IDs used in signing, `sendAsset` vs `spotSend`, and the CoreWriter and CoreDepositWallet addresses.
4. **Existing live companies** need a backfill: an EVM key, API wallet approval and a Unit address. Their SOL balances sweep over on the first run.
5. **Accounting switch:** historic ledger rows stay in lamports with `currency = "SOL"`. Reports convert at the stored rate.

## Sources
- Unit deposit addresses and minimums: https://docs.hyperunit.xyz/developers/api/generate-address · https://app.hyperunit.xyz/?asset=sol
- Hyperliquid API wallets and signing: https://docs.chainstack.com/docs/hyperliquid-authentication-guide · https://www.dwellir.com/docs/hyperliquid/approveAgent
- HyperCore ↔ HyperEVM transfers: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/hypercore-less-than-greater-than-hyperevm-transfers
- USDC onto HyperCore: https://docs.chainstack.com/docs/hyperliquid-bridging-usdc
