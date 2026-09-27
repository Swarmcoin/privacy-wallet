# The Treasury page

A 2-of-3 fund payout, on two machines, without the command line.

This page does not replace the custody design and does not weaken it. It runs
the same `swarm-treasury` code the offline ceremony runs — the same policy
check, the same proposal, the same two independent signatures made on two
different machines with two different signer files, the same combiner running
the same script interpreter. What it replaces is the part that was never the
security: carrying JSON files between two laptops on a memory stick.

- Register your signer file **once per machine**.
- A payout appears as a card. You read it, you type your passphrase.
- Your signature reaches the coordinating machine automatically, encrypted.
- Two clicks, on two machines.

---

## Before you start

**On each machine that will sign,** you need that machine's own
`*.signer.age` backup from the custody ceremony and the passphrase for it.
One signer per machine, as the custody design says. A machine with no signer
can still watch the funds and coordinate a payout; it just cannot sign.

**Never** put two of a policy's three signer files on one machine. Two
signatures made in the same place are one signature with extra steps.

The page appears on the **mainnet** build only. On a testnet build it is
hidden unless a testnet policy has been put in front of it, because the four
funds are mainnet addresses and a page that offered to spend from them on a
chain that has no such addresses would refuse everything for reasons nobody
could read.

---

## The four funds

The build ships their policies as read-only data
(`resources/treasury/*.policy.json`, staged into the package). It does not
fetch them, and nothing in the running application can replace them.

| Fund | Threshold | Address |
|---|---|---|
| Core | 2 of 3 | `s3fLmEHc1xqs8KAe7QS7oupkhuGDjidV4eq` |
| Grants | 2 of 3 | `s3RiGvK5JzS8eh6ywN3K22f2LzDAhicgFuq` |
| Reserve | 2 of 3 | `s3g3pzQVhvVX17bzrrEN3vmcXZWSpj7KFVp` |
| Mining | 1 of 3 | `s3R1bWZPrRCtKL122ZN6uySu1ewk2ku849C` |

Every fingerprint the page shows is **recomputed** by the addon from the
policy's own keys — the redeem script, the `HASH160` of it, the address and
the policy fingerprint are all derived, not read out of the file. A policy
file that had been edited after packaging is refused on the machine that
reads it, with the fund missing from the list and the reason printed above
it.

---

## Step 1 — Register this machine's signer (once)

**Treasury → Signers → Register a signer file.**

*Screenshot: the Signers panel, empty, with one primary button reading
"Register a signer file" and a note under the heading explaining that the
file is copied here still encrypted.*

Choose the `*.signer.age` file. The app asks for its passphrase **once**, to
prove the file opens and to read the label and the fingerprint out of it —
nothing else. It then copies the file into the application's own data
directory **exactly as it found it: still an `age` file, still encrypted
under the ceremony passphrase.**

*Screenshot: the masked passphrase modal, titled "The passphrase for this
signer file", with the sentence "Asked once, to prove the file opens and to
read its label and fingerprint. It is not stored: every signature asks
again."*

The signer then appears as a label and a fingerprint.

*Screenshot: the Signers panel with one row: "B · f09232728bf931f2" and a
Remove button.*

**What is never stored:** the passphrase, and the decrypted key. Every
signature asks for the passphrase again, uses it for that one call, and
drops it. Removing a signer deletes both the `age` file and its record.

---

## Step 2 — The coordinating machine builds the payout

**Treasury → Funds.** Press **Refresh** on the fund you are paying from. The
app asks the indexer (`GetAddressUtxos`, the same lightwalletd call the
wallet already uses for its own sync) what that address holds, and shows the
mature and the not-yet-spendable totals separately.

*Screenshot: the Funds panel, four funds, each with its address, its
recomputed policy fingerprint, and a balance line reading "1,250.00000000
mature, 50.00000000 not yet spendable (4 outputs at height 3,004,112)".*

> **Why "not yet spendable".** A treasury collector output is a coinbase
> output, and a coinbase output needs 100 confirmations. The page never
> selects one before then: a proposal that spent one early would be refused
> by the network *after* two people had signed it.

Press **New payout from Core**. Fill in three things:

- **At least how much.** A floor, not an exact amount — see below.
- **To.** Defaults to this wallet's own shielded address, so the ordinary
  case (move funds into the operating wallet) needs no typing. Change it to
  pay someone else.
- **Memo.** What the payout is for. It travels with the shielded note.

As soon as the amount is a number, the page explains what will actually
happen:

> You asked for at least 100.00000000 SWM. The smallest set of 2 whole
> outputs that reaches it comes to 125.00000000 SWM. A payout from a
> collector output cannot carry change, so all of it leaves the fund: the
> recipient receives 125.00000000 SWM less the fee.

*Screenshot: the New payout form with the amount field filled in and that
paragraph below it in the guidance box, followed by "2 outputs, heights
3001200, 3002450."*

> **Why the amount you type is a floor.** The preserved consensus rules
> forbid a transaction that spends a coinbase output from having *any*
> transparent output — not even change back to the same 2-of-3 address. So
> the only disbursement the custody tool will build is: take **whole**
> outputs, pay all of their value minus the fee to one shielded recipient,
> keep nothing. The page picks the fewest whole mature outputs that reach
> your floor (largest first, which is also cheapest, because the ZIP-317 fee
> is charged per input), and then tells you the exact amount before you build
> anything.

Press **Build the proposal.** This takes a few seconds: it is making a real
Halo2 proof for the shielded output.

---

## Step 3 — Read the card

*Screenshot: the proposal card. A kicker reading "PROPOSAL 9a9a9a9a9a9a9a9a…",
then in large type "THE RECIPIENT RECEIVES 124.99985000 SWM", then a fact
list: Fund, From, To, Raw receiver, Memo, Leaving the fund, Fee, Change
("none — a coinbase spend may carry no transparent output at all"), Network,
Expires at height, Policy. Two collapsed sections below it, and the full
64-character proposal hash at the bottom.*

Every number on that card was recomputed from the transaction's own bytes.
The addon re-derives the proposal hash and every input digest from the raw
transaction before it answers, and **refuses** if either differs from what
the file records — so a card that appears at all is a proposal whose own
numbers hold up. A forged hash produces no card, only:

> the proposal's own hash does not match its contents: the file says …, this
> build computes …. Do not sign it.

**Compare the proposal hash out loud with the other machine before either of
you types a passphrase.** It is printed at the top and at the bottom of the
card for exactly that reason.

---

## Step 4 — Sign here, then share

If this machine holds one of the policy's signers, the card has a **Sign here
as A** button. Press it, type the passphrase, and the signature count becomes
1 of 2.

Then press **Share for second signature**. The page:

1. draws a **six-word session code**;
2. seals the proposal and the policy under it (`age`, scrypt recipient — the
   same format the signer backups use);
3. derives the relay path from an iterated, domain-separated hash of the same
   code;
4. leaves the sealed blob there.

*Screenshot: the guidance box headed "Read these six words to the other
machine", the code in large monospace — "bala dote koba nemi rate vibo" —
a note saying the relay cannot open it and that the words stop working after
24 hours, and a "Copy the code" button.*

> **What the relay knows.** A 64-character hexadecimal path, and some bytes.
> It cannot read a blob, cannot tell which fund the payout is from, how much
> it is for, who the recipient is or which two machines are talking, and
> cannot work back from a path to a code. It keeps nothing on disk and drops
> everything after 24 hours. Run by someone hostile, the worst it can do is
> fail to deliver — which this page notices, and which costs one re-share.
>
> **What the six words are.** They are the key. Anyone who learns them can
> read the payout. Say them to the other signer and to nobody else: a phone
> call, in person, or any channel you would trust with the payout itself.
> They are not a password to be reused and they are not worth writing down —
> they stop working in a day.

---

## Step 5 — The other machine signs

On the second machine: **Treasury → Incoming payout.** Type the six words and
press **Fetch the payout**.

*Screenshot: the Incoming payout panel, the code field filled with six words,
and the same proposal card below it with a single primary button reading
"Sign as B".*

The card is the same card, drawn from the same recomputation on this machine
— not a picture of the first machine's card. The policy that arrived with the
proposal is verified here too, and matched against the policies **this build
ships**: a proposal under a policy this build does not carry is refused with

> This proposal is under a policy this build does not ship (…). Do not sign
> it.

Check the proposal hash against the one the coordinator read to you. Then
**Sign as B**, type that machine's passphrase, and the signature goes back to
the relay sealed under the same six words.

*Screenshot: the panel after signing, showing "Signed and sent back, sealed
under the same code. The coordinating machine can combine now. Nothing else
is needed from this machine."*

---

## Step 6 — Combine and broadcast

Back on the coordinating machine, press **Check for signatures**. It fetches,
opens what it can, and adds any signature over *this* proposal. A signature
over a different proposal is refused and named:

> That signature is over a different proposal (ee ee ee ee…), not this one
> (9a 9a 9a 9a…). It has not been added.

The same signature fetched twice counts once — the threshold counts distinct
signer fingerprints, not blobs.

When the count reaches the policy's threshold, **Combine** becomes live.
Combining runs the script interpreter over the assembled transaction, so a
combine that returns at all returned something the interpreter accepted. You
get a txid.

*Screenshot: the payout panel with "Signatures 2 of 2 — A (this machine), B
(the relay)", a live Combine button, and below it a Combined box with the
64-character txid.*

Then **Broadcast** — its own press, on its own panel, because it is the one
irreversible step. It goes out through `SendTransaction`, the same
lightwalletd call the wallet's own payments use, and the txid the panel then
shows is the one the server answered with rather than the one the combiner
assumed.

*Screenshot: the Sent box, with the txid and the sentence "The network took
it. From here it is a payment like any other: it will appear in this
wallet's own Activity, with its confirmations, as soon as the wallet next
syncs past the block it lands in."*

---

## When something goes wrong

| What you see | What it means |
|---|---|
| "Nothing is waiting under that code." | Not shared yet, or the 24 hours passed. The coordinator shares again — a new code, a new path. |
| "That session code does not open this blob." | A typo, or two people are in two different sessions. Compare the six words. |
| "This machine holds no signer that this fund's policy names." | Right payout, wrong machine. Register that machine's signer file. |
| "the proposal's own hash does not match its contents" | **Stop.** Do not sign. The proposal file and its own transaction disagree. |
| "the indexer returned an output that is not locked to this fund" | **Stop.** The indexer answered for a different address than the policy's. Tell the planner. |
| "The relay is rate-limiting this machine." | Wait a minute. 60 requests a minute, per client. |
| A fund missing from the Funds list, with a red line above it | That shipped policy did not verify on this machine. Do not work around it. |

**The offline ceremony still works.** Nothing here removes it: the same
`swarm-treasury` binary, the same files, the same steps as
`docs/swarm-treasury.md` in the node repository. If the relay is down, or the
page refuses something you believe is right, fall back to it.

---

## How it is put together

| Piece | Where |
|---|---|
| The custody tool | `swarm-treasury`, a git dependency of `native/` pinned at privacy-zebra `01b9da3d` |
| The addon bindings | `native/src/treasury.rs` — ten functions, JSON in, JSON out, plus their own Rust tests against the published fixture scalars |
| Selection, session code, envelopes, the state machines | `src/treasury/` |
| The page | `src/components/swarm/screens/TreasuryScreen.tsx`, with `ProposalCard` and `PassphrasePrompt` beside it |
| Files, the picker, the signer store, the relay's HTTP | `public/electron.js`, allowlisted in `public/preload.js` |
| The relay | `Swarm-Official/swarm-treasury-relay` |
| The fund policies | `resources/treasury/*.policy.json`, staged by `configs/swarm-builder.cjs` |

**What was not built here:** any cryptography. The page adds none. Every
signature, every proof, every hash and every script check comes from the
crate the offline ceremony already uses, at the revision it was rehearsed at.
