# Hypeware contracts (HyperEVM)

## FeeSplitter

Splits Hypeware's platform revenue between the **flagship company** and the **platform**, in public and by fixed rules.

- **Anyone can call `distribute(ref)`.** It splits the USDC the contract holds and only ever pays the two configured recipients.
  - The flagship's share (`flagshipBps`) goes straight into the flagship's **HyperCore spot balance** through Circle's `CoreDepositWallet.depositFor`, where its agent uses it.
  - The rest goes to `platform` on HyperEVM.
- **Changes are public and slow.** Changing the split or recipients needs `proposeConfig` (owner), then a **2-day** wait, then `applyConfig` (anyone). The owner can `cancelConfig`.
- **The owner can't take the USDC.** USDC only leaves through `distribute`. `rescue` returns other tokens sent by mistake.
- **No upgrades, no dependencies.** Two-step ownership transfer, a re-entrancy guard, and ERC-20 calls that tolerate tokens returning no value.

How money gets there: companies pay the platform's 5% to `PLATFORM_HL_WALLET` on HyperCore, and those amounts are recorded in `platform_revenue`. The backend job (`firmware/src/lib/hl/fee-splitter.ts`) then:
1. moves exactly what's owed from the wallet's HyperCore balance to its own HyperEVM address (USDC system address `0x2000…0000`)
2. sends it to the contract
3. calls `distribute`

Compute repayments that land in the same wallet are **not** distributed.

### Test
```bash
forge test -vv
```
The tests cover the split math (fuzzed), the timelock, ownership, rescue never touching USDC, re-entrancy and tokens that return `false`. They use no external libraries; the Foundry cheatcodes are declared inline.

### Deploy (testnet first)
```bash
OWNER=0x<multisig or ops key> FLAGSHIP=0x<flagship company's hlAddress> PLATFORM=0x<platform treasury> FLAGSHIP_BPS=5000 \
forge script script/DeployFeeSplitter.s.sol --rpc-url hyperevm_testnet --broadcast --private-key $DEPLOYER_KEY
```
- USDC and the CoreDepositWallet default to Circle's addresses for chain 998 (testnet) and 999 (mainnet). Before deploying, the script checks `CoreDepositWallet.token() == USDC`.
- `FLAGSHIP_BPS` is a share of the platform's cut. Match it to `FLAGSHIP_SHARE_PCT` (50% → 5000).
- Deployment uses about 1.3M gas, which fits HyperEVM's small blocks (2M).

Then set, in the backend `.env`:
```
FEE_SPLITTER_ADDRESS=0x<deployed>
PLATFORM_HL_WALLET=0x<platform wallet>
PLATFORM_HL_KEY_SEALED=…        # PLATFORM_HL_PRIVATE_KEY=0x… npm run hl -- seal-platform-key
```
The platform wallet needs a little HYPE on HyperEVM for gas (≥ 0.001) and on HyperCore for the transfer to HyperEVM.

### Before mainnet
**Get an external audit.** This contract holds platform money. Also confirm on testnet that a `depositFor` to the flagship's HyperCore account lands in its spot balance. A community report says deposits to brand-new testnet accounts can fail, so use an account that already exists.
