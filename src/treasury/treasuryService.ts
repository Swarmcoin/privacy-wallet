/**
 * The typed layer over the two boundaries the Treasury page talks across:
 * the addon (cryptography) and the main process (files, the picker, the
 * relay).
 *
 * Nothing in here decides anything. It parses, it names the errors, and it
 * refuses to hand a screen a shape the screen would have to guess about.
 */

import { native, ipcRenderer } from "../electronBridge";
import type { Fund, ProposalSummary, RegisteredSigner } from "./treasuryMachine";
import type { TreasuryUtxo, TreasuryUtxoSet } from "./selectUtxos";
import { RelayClient, type RelayTransport } from "./relayClient";

/** What the addon answers for a verified policy. */
type VerifiedPolicy = {
  fund: string;
  network: string;
  threshold: number;
  signers: { label: string; public_key: string; fingerprint: string }[];
  redeem_script: string;
  lock_script: string;
  script_hash: string;
  address: string;
  policy_fingerprint: string;
  created: string;
};

/** What the addon answers for an imported signer file. */
export type ImportedSigner = {
  label: string;
  public_key: string;
  fingerprint: string;
  created: string;
};

/** What the addon answers for a combine. */
export type CombinedTransaction = {
  raw_hex: string;
  txid: string;
  record: { signers: string[]; fee: number; amount_out: number; transaction_bytes: number };
};

/** The shape the Treasury page keeps a fund in, with its lock script. */
export type LoadedFund = Fund & { lockScript: string; network: string };

/**
 * The fund policies this build ships.
 *
 * Read-only data staged into the package (`resources/treasury`), not
 * downloaded and not editable from the app: a policy is what decides where
 * money may go, and a policy the app could be talked into replacing is no
 * policy at all. Every one of them is put through `treasury_policy_verify`,
 * which recomputes the redeem script, the script hash, the address and the
 * fingerprint rather than reading them out of the file — so a shipped file
 * that had been edited would be refused here, by this build, on this
 * machine.
 */
export async function loadFunds(): Promise<{ funds: LoadedFund[]; problems: string[] }> {
  const shipped = (await ipcRenderer.invoke("treasury:policies")) as {
    file: string;
    json: string;
    fileSha256: string;
  }[];
  const funds: LoadedFund[] = [];
  const problems: string[] = [];
  for (const entry of shipped) {
    try {
      const verified = JSON.parse(await native.treasury_policy_verify(entry.json)) as VerifiedPolicy;
      funds.push({
        name: verified.fund,
        policyJson: entry.json,
        fingerprint: verified.policy_fingerprint,
        address: verified.address,
        threshold: verified.threshold,
        signerFingerprints: verified.signers.map((s) => s.fingerprint),
        fileSha256: entry.fileSha256,
        lockScript: verified.lock_script,
        network: verified.network,
      });
    } catch (error) {
      problems.push(`${entry.file}: ${String(error)}`);
    }
  }
  return { funds, problems };
}

/** The signer files this machine has been given, still encrypted on disk. */
export async function listSigners(): Promise<RegisteredSigner[]> {
  return (await ipcRenderer.invoke("treasury:signers:list")) as RegisteredSigner[];
}

/**
 * Registers this machine's signer file.
 *
 * The passphrase is asked for once, here, to prove the file opens and to read
 * the label and the fingerprint out of it. It is not stored: every later
 * signature asks again.
 */
export async function registerSigner(
  ageHex: string,
  passphrase: string,
): Promise<RegisteredSigner> {
  const imported = JSON.parse(
    await native.treasury_signer_import(ageHex, passphrase),
  ) as ImportedSigner;
  return (await ipcRenderer.invoke("treasury:signers:add", {
    fingerprint: imported.fingerprint,
    label: imported.label,
    publicKey: imported.public_key,
    created: imported.created,
    ageHex,
  })) as RegisteredSigner;
}

export async function removeSigner(fingerprint: string): Promise<void> {
  await ipcRenderer.invoke("treasury:signers:remove", fingerprint);
}

/** Opens the file picker and returns the chosen backup's bytes. */
export async function pickSignerFile(): Promise<{ path: string; ageHex: string } | null> {
  const answer = (await ipcRenderer.invoke("treasury:pick-signer-file")) as {
    canceled: boolean;
    path?: string;
    ageHex?: string;
  };
  if (answer.canceled || !answer.path || !answer.ageHex) return null;
  return { path: answer.path, ageHex: answer.ageHex };
}

/** What a fund's address holds, according to the indexer. */
export async function loadFundUtxos(
  serverUri: string,
  fund: LoadedFund,
): Promise<TreasuryUtxoSet> {
  return JSON.parse(
    await native.treasury_utxos_from_lightwalletd(serverUri, fund.address, fund.lockScript),
  ) as TreasuryUtxoSet;
}

/** Builds a proposal from a selection the coordinator has already seen explained. */
export async function buildProposal(input: {
  fund: LoadedFund;
  utxos: TreasuryUtxo[];
  recipient: string;
  memo: string;
  expiryHeight: number;
  fee?: number | null;
}): Promise<{ proposalJson: string; summary: ProposalSummary }> {
  const request = JSON.stringify({
    policy: JSON.parse(input.fund.policyJson),
    utxos: input.utxos.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      value: u.value,
      height: u.height,
      is_coinbase: u.is_coinbase,
      script: u.script,
    })),
    recipient: input.recipient,
    memo: input.memo,
    expiry_height: input.expiryHeight,
    fee: input.fee ?? null,
    // The network upgrade the transaction is built under, spelled the way
    // the custody tool spells it (`Pool::parse`): `nu6_3`, the mainnet case,
    // which pays into the Ironwood pool. `v6_ironwood` is the name of the
    // Rust variant, not of the input, and passing it is refused.
    pool: "nu6_3",
  });
  const proposalJson = await native.treasury_proposal_build(request);
  const summary = await summarise(proposalJson, input.fund.policyJson);
  return { proposalJson, summary };
}

/**
 * The card every screen shows.
 *
 * This is also the check: the addon recomputes the proposal hash and every
 * input digest from the raw transaction, and refuses if either differs from
 * what the file records. A summary that returns is a proposal whose own
 * numbers hold up.
 */
export async function summarise(
  proposalJson: string,
  policyJson: string,
): Promise<ProposalSummary> {
  return JSON.parse(
    await native.treasury_proposal_summary(proposalJson, policyJson),
  ) as ProposalSummary;
}

/** Signs with one of this machine's signers. The passphrase is used once. */
export async function signProposal(input: {
  proposalJson: string;
  policyJson: string;
  fingerprint: string;
  passphrase: string;
}): Promise<{ signatureJson: string; fingerprint: string; label: string; proposalHash: string }> {
  const ageHex = (await ipcRenderer.invoke("treasury:signers:read", input.fingerprint)) as string;
  const signatureJson = await native.treasury_proposal_sign(
    input.proposalJson,
    input.policyJson,
    ageHex,
    input.passphrase,
  );
  const parsed = JSON.parse(signatureJson) as {
    fingerprint: string;
    label: string;
    proposal_hash: string;
  };
  return {
    signatureJson,
    fingerprint: parsed.fingerprint,
    label: parsed.label,
    proposalHash: parsed.proposal_hash,
  };
}

/** Combines the collected signatures. The script interpreter runs inside. */
export async function combine(
  proposalJson: string,
  policyJson: string,
  signatureJsons: string[],
): Promise<CombinedTransaction> {
  const combined = await native.treasury_signatures_combine(
    proposalJson,
    policyJson,
    `[${signatureJsons.join(",")}]`,
  );
  return JSON.parse(combined) as CombinedTransaction;
}

/**
 * Hands the combined transaction to the network.
 *
 * The same `SendTransaction` the wallet's own payments go out through: a
 * treasury payout is not special to the indexer, and it must not need a
 * node, an RPC cookie or a second piece of infrastructure to reach the
 * network. The txid comes back from the server rather than being assumed
 * from the combiner's.
 */
export async function broadcast(serverUri: string, rawHex: string): Promise<string> {
  const answer = JSON.parse(await native.treasury_broadcast(serverUri, rawHex)) as {
    txid: string;
  };
  return answer.txid;
}

/** Seals a blob for the relay under the session code. */
export async function seal(code: string, plaintext: string): Promise<string> {
  return native.treasury_seal(code, plaintext);
}

/** Opens a blob from the relay with the session code. */
export async function unseal(code: string, ciphertextHex: string): Promise<string> {
  return native.treasury_unseal(code, ciphertextHex);
}

/**
 * The relay path a session lives at.
 *
 * Asynchronous although the addon's own function is not: every native call
 * reaches the renderer through the preload bridge, which makes all of them
 * promises (`RendererNativeAPI` in src/electron-api.d.ts).
 */
export async function sessionIdFor(code: string): Promise<string> {
  return native.treasury_session_id(code);
}

/** The relay transport, over the main process's host-allowlisted fetch. */
export const ipcRelayTransport: RelayTransport = (request) =>
  ipcRenderer.invoke("treasury:relay", request) as Promise<{
    ok: boolean;
    status: number;
    text: string;
  }>;

/**
 * Where the relay lives.
 *
 * The same host the wallet's own indexer is on: it is a path on that host's
 * Caddy, not a second service to find. Derived from the configured server
 * URI so a build pointed at a different endpoint does not silently keep
 * talking to the production relay.
 */
export function relayBaseUrl(serverUri: string): string {
  const parsed = new URL(serverUri.includes("://") ? serverUri : `https://${serverUri}`);
  return `${parsed.protocol}//${parsed.hostname}`;
}

export function relayFor(serverUri: string): RelayClient {
  return new RelayClient(relayBaseUrl(serverUri), ipcRelayTransport);
}
