# Swap traffic and the mixnet

The swap layer's HTTP leaves the machine over clearnet. `swapHttp:request`,
`swapLogo:get`, and the Midgard queries all run `fetch` from the main process
with no proxy, while the wallet's own indexer traffic rides the Nym mixnet.

**Decided 2026-08-27: this ships as it is.** Routing swap traffic through the
mixnet is deferred, not rejected, and the options are kept in **If it is
revisited** below so whoever picks it up does not repeat the analysis. What
shipped alongside the decision is the disclosure: the Swap screen now says the
provider sees the user's IP, so the mixnet indicator and this screen stop
disagreeing.

One related finding was accepted in the same pass: `native/Cargo.toml` pins
zingolib by branch against ADR 0024 rule 7, which stands until that branch
merges.

## The shape of it

A quote is an ordinary HTTPS request to the provider, so the provider sees
where it came from along with what it asks. The request has to carry wallet
addresses to be answerable at all, which is what makes this more than a
network-level observation: it puts an address the wallet controls beside
something that identifies the machine. Tracking repeats that for as long as the
swap runs, and the Midgard queries behave the same way.

Keeping those two apart is what a shielded wallet is for, and here they are
not. That is the whole of the concern, and it is why the decision above is a
deferral rather than a dismissal.

The addresses also travel further than the provider. NEAR Intents screens the
addresses in its quote flows against outside AML sources — its own portal,
Binance AML, AMLBot and PureFi, with TRM Labs added for non-dry quotes, per its
Risk & Compliance docs — so a quote the user never commits can still put the
wallet's ZIP-320 address and the counterparty address in front of those
services. The mixnet would not change that; only not sending the addresses
would.

Flashnet is asked directly in one case. SwapKit's `/track` does not report
the deposit transaction of an inbound Flashnet swap, so once Flashnet has
taken the order the wallet reads that hash from Flashnet's explorer API, by
order id, over clearnet. Flashnet already holds the order; what it learns
is the IP asking about it. The request is made at most once a minute per
order until the hash is found, and never again after.

Token logos are a separate leak with a different shape. Their hosts arrive
inside SwapKit's catalog rather than being ours to know, and the asset picker
renders up to 60 at a time, so opening it contacts whatever CDNs the catalog
names and tells each one which tokens the user is looking at. That part
remains.

Two things about them were fixed rather than accepted. `swapLogo:get` used to
fetch any HTTPS URL the renderer named, which answered whether an arbitrary
host serves an image; it now accepts only hosts harvested from the catalog as
it passes through `swapHttp:request`, so the allowlist comes from SwapKit
rather than from a guess here. And the cache, which held data URIs of up to
256 KB with no bound, now evicts oldest-first under a byte budget and
remembers a logo that would not load so the picker stops asking for it.

## What the user is told

`MixnetModal` says the mixnet "hides your IP from the indexer when you send".
Scoped to the indexer, so the text is accurate as written. It is also not what
a user reads off a green mixnet indicator, and a swap sends more to SwapKit
than a send sends to an indexer.

The Swap screen closes that gap directly rather than leaving the reader to
infer it, in the words the decision above settled on: swaps reach the provider
directly, and quoting or tracking one shows the provider an IP address
alongside the assets, the amount, and the addresses. Stated as what the
provider sees, since that is the fact, and the remedy is the user's to choose.

## The precedent

zingolib ADR 0024 ruled on this shape already. Its Context names the failure:

> Both shipping consumers fetch price over clearnet while their disclaimers
> claim the mixnet covers price-fetch.

and rule 6 resolves it:

> The 2026-07-23 mixnet-only rule is reinstated in full... The driver refuses
> price in every state except ready; a build without the nym feature compiles
> no fetch.

zingo-pc already honours that for price: the display goes dark until the
mixnet converges. Swap traffic is the same shape, carrying more.

Rule 8 leaves narration to each consumer while zingolib owns "the shared
semantic sentences: the IP-correlation disclaimer and refusal remedies", so
whatever is decided here should reach the user in zingolib's words rather than
a second set invented in this repo.

## If it is revisited

Deferred on 2026-08-27, with the analysis kept so the next attempt starts here
rather than at the beginning.

**Through zingolib.** A mixnet-capable HTTP call in zingolib that zingo-pc
consumes, the way price already works. What ADR 0024 asks for by rule 1's "one
mint, N renderers", since zingolib owns the mixnet surface and `zingo-netutils`
already speaks SOCKS5. Costs a new public surface there and a cross-repo
change.

**SOCKS5 in main.** A proxy agent over `mixnet.socks5Addr`, which main already
holds. Self-contained and small. It also puts mixnet transport policy back in a
renderer, which is the divergence ADR 0024 was written to end, and would be the
fourth place that policy lives.

The third option, saying it out loud and leaving the traffic where it is, is
what shipped. It costs nothing to keep if either of the above lands later: a
screen that has stopped claiming privacy it does not have is still telling the
truth once it does.

## Adjacent

`native/Cargo.toml` pins zingolib by branch. ADR 0024 rule 7: "Consumers
declare exactly one wallet dependency: zingolib at a git rev, never a branch."
A one-line change once `opreturn_on_proposal` lands.

## The SWM price

Since 0.1.0-mainnet.11 (unreleased) the wallet shows the SWM price on SWARM
mainnet wallets: a price card on the Overview, the balance in US dollars
under the total, and the amount in dollars on Send. Specification:
`specs/PRICE-DISPLAY.md` in the project repository.

**Where it comes from.** Only from the SWARM price service,
`GET https://wallet.swarm.green/api/price/swm`. That service reads the
SWM/ETH Uniswap v4 pool on Base from GeckoTerminal and DexScreener and
caches the result. The wallet never contacts GeckoTerminal, DexScreener or
any other third party for a price: a wallet that did would tell that party,
once a minute, that this IP runs a SWARM wallet.

**What leaves the machine.** One unauthenticated GET per minute, carrying
no address, no balance, no wallet identifier, no cookie and no referrer.
The URL is fixed in the main process (`public/swmPrice.js`), which accepts
that one host exactly, refuses redirects, gives up after 8 seconds, reads at
most 64 KiB and checks the answer (`schema: "swarm-price/1"`, a positive
decimal price) before the renderer sees any of it. The renderer passes no
URL and cannot widen the list; the channel also checks that the call comes
from the wallet's own page.

**When.** Only while all of these hold: the build is a SWARM mainnet build,
the open wallet is a SWARM mainnet wallet, the wallet is open and unlocked,
the window is visible, and the setting is on. Minimising the window stops
the requests; bringing it back makes one at once. Testnet builds and testnet
wallets make none.

**How it travels.** Over clearnet, like the treasury relay, not through the
mixnet. What it reveals to the SWARM host is that this IP runs a SWARM
wallet with the price switched on; nothing about the wallet's contents. The
ZEC price that zingolib fetches over the mixnet (ADR 0024 rule 6, above) is a
different request and stays switched off on SWARM.

**The switch.** Settings → Price → "Show SWM price (USD)", on by default.
Off means no price requests at all and no price anywhere on screen. The
last good reading is kept in the renderer's local storage so the next start
can show it, greyed, until a fresh one arrives.

**The price page and its links.** Clicking the price card opens the
wallet's own price page (rail entry "Price", `/price`), which reads the same
answer and makes no request of its own. Its "Open on DexScreener" and "Open
on GeckoTerminal" buttons open the pool's page in the system browser. Both
URLs are constants in the main process; the renderer names "dexscreener" or
"geckoterminal" and nothing else. Opening one is the user's own visit to that
site, with the browser's own privacy, not a request the wallet makes. The
pool id and token contract the page shows and copies are constants of the
build, never the relay's copy of them.

**What the number is.** An indicative price from a small pool, which small
trades move. The card says so, and calls it "not a quote". The dollar values
are the balance in zatoshis times the relay's decimal price, rounded half-up
to cents: a display, never part of a payment.
