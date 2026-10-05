/**
 * The SWM token and its pool, as facts of this build (specs/PRICE-DISPLAY.md
 * §1). The price page shows and copies these, never the relay's copy of
 * them: an address a person copies out of a wallet must not come from the
 * network.
 */
export const SWM_POOL_ID = "0xf1e066d77279b388b40fdca7f5cf4a6559f77bdf9e2e8937ce9c2fe2960f4599";
export const SWM_TOKEN_ADDRESS = "0xf904C14d21bEF5b8a5345a666C77C9cc2A24043B";
/** Uniswap v4 "SWM / ETH 0.9 %"; the relay's `pool.fee_pct` wins when it sends one. */
export const SWM_POOL_FEE_PCT = 0.9;

export const SWM_PRICE_FOOTNOTE =
  "Indicative price from the SWM/ETH pool on Base. The pool is small; small trades move it. Not a quote.";

/** Settings → Price, and the foot of the price page: specs/PRICE-DISPLAY.md §2.2, word for word. */
export const SWM_PRICE_SETTING_LABEL = "Show SWM price (USD)";
export const SWM_PRICE_SETTING_HELP =
  "The price comes from the SWARM price service (wallet.swarm.green), which reads the SWM/ETH pool on Base from GeckoTerminal and DexScreener. Your addresses and balances are never sent. Switch this off and the wallet makes no price requests.";
