//! The treasury custody surface, with no Node in it.
//!
//! Every function a 2-of-3 fund payout needs, as plain Rust over plain
//! strings of JSON. The crate behind it (`swarm-treasury`, in the node
//! repository) is the same code the offline command-line ceremony uses —
//! nothing here adds cryptography, it only lends the tool a window.
//!
//! # Why this is its own crate
//!
//! The addon beside it is a `cdylib` that links Node's symbols, and a test
//! binary built from that crate has nothing to resolve them against. A
//! treasury surface that could not be tested would be a treasury surface
//! nobody should sign with, so the work lives here, where `cargo test` is
//! an ordinary thing to run, and `native/src/treasury.rs` is the Neon glue
//! that calls it.
//!
//! # What crosses the boundary
//!
//! Strings of JSON in, strings of JSON out. Two things never cross in the
//! other direction:
//!
//! * **the signer's secret scalar.** [`signer_import`] decrypts a backup
//!   only to read the label, the public key and the fingerprint out of it,
//!   and returns those. The `*.signer.age` bytes stay encrypted; the caller
//!   stores them exactly as it received them.
//! * **the passphrase.** It is passed in for one call, used once, and
//!   dropped at the end of it. [`swarm_treasury::signer::Passphrase`] keeps
//!   it out of `Debug` output.
//!
//! # The relay seal
//!
//! [`seal`] and [`unseal`] wrap the same `age` passphrase (scrypt) format
//! the signer backups use, so the relay in the middle holds bytes it cannot
//! read. The passphrase is the six-word session code the coordinator reads
//! off the screen; [`session_id`] is a *separately domain-separated,
//! iterated* hash of the same code, so the id the relay stores under cannot
//! be turned back into the key without breaking `age`'s scrypt as well.

#![forbid(unsafe_code)]
// These functions are called by someone about to sign away real money:
// every fallible step returns an error rather than panicking.
#![cfg_attr(not(test), deny(clippy::unwrap_used, clippy::expect_used))]

use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use swarm_treasury::{
    policy::{self, CheckedPolicy, Policy},
    shielded::{self, Pool},
    signer::{self, Passphrase},
    spend::{self, Proposal, SignatureFile},
    utxo::{self, UtxoEntry, UtxoFile},
};

/// How many confirmations a coinbase output needs before it can be spent.
///
/// The preserved Zcash rule, which SWARM did not change. A treasury
/// collector output is a coinbase output, so this is the only maturity that
/// matters here.
pub const COINBASE_MATURITY: u32 = 100;

/// The domain separator for the relay session id.
///
/// Deliberately different from anything `age` hashes: the id and the
/// encryption key are derived from the same six words down two different
/// paths, so learning one does not hand over the other.
const SESSION_ID_DOMAIN: &str = "swarm-treasury-relay-session-v1:";

/// How many times the session id's hash is iterated.
///
/// Six words out of a 2048-word list is about 66 bits. Against a single
/// SHA-256 that is uncomfortably close to what a determined GPU farm can
/// walk inside the relay's 24-hour window, and the relay stores blobs under
/// the id, so an id that could be reversed would let it link the two
/// machines of one payout even though it still could not read them.
///
/// Iterating costs this machine about a millisecond, once per session, and
/// costs an attacker sixty-five thousand times more. The `age` scrypt
/// recipient already protects the blobs themselves; this protects the
/// linkage.
const SESSION_ID_ROUNDS: u32 = 65_536;

/// Anything the treasury surface refuses.
///
/// One variant, because every one of these messages is read verbatim by
/// someone about to sign: "the proposal's own hash does not match its
/// contents" must not arrive on screen wearing a category name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TreasuryError(pub String);

impl std::fmt::Display for TreasuryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for TreasuryError {}

pub type Result<T> = std::result::Result<T, TreasuryError>;

/// Turns any error with a message into this crate's error type.
pub fn fail(context: &str, error: impl std::fmt::Display) -> TreasuryError {
    TreasuryError(format!("{context}: {error}"))
}

/// Refuses with a message of our own.
pub fn refuse(message: impl Into<String>) -> TreasuryError {
    TreasuryError(message.into())
}

// -- the shared checks -------------------------------------------------------

/// Parses a policy file and checks it, recomputing everything it claims.
pub fn checked_policy(policy_json: &str) -> Result<CheckedPolicy> {
    let parsed: Policy = serde_json::from_str(policy_json)
        .map_err(|error| fail("this is not a swarm-treasury policy file", error))?;
    policy::verify(&parsed).map_err(|error| fail("the policy does not verify", error))
}

/// Parses a proposal, checks it against the policy, and refuses if the
/// recorded proposal hash is not the hash of what the file actually holds.
///
/// `spend::check` already recomputes every input digest from the raw
/// transaction rather than trusting the recorded ones. The extra hash
/// comparison here is what lets every screen say "proposal hash" and mean
/// it: the number on the screen is the number this build computed, not the
/// number the file asked to be believed about.
pub fn checked_proposal(
    proposal_json: &str,
    policy: &CheckedPolicy,
) -> Result<(Proposal, spend::CheckedProposal)> {
    let proposal: Proposal = serde_json::from_str(proposal_json)
        .map_err(|error| fail("this is not a swarm-treasury proposal", error))?;
    let recomputed = spend::proposal_hash(&proposal);
    if recomputed != proposal.proposal_hash {
        return Err(refuse(format!(
            "the proposal's own hash does not match its contents: the file says {}, \
             this build computes {recomputed}. Do not sign it.",
            proposal.proposal_hash,
        )));
    }
    let checked = spend::check(&proposal, policy)
        .map_err(|error| fail("the proposal does not check", error))?;
    Ok((proposal, checked))
}

/// The `age` recipient for a passphrase.
fn scrypt_recipient(passphrase: &str) -> age::scrypt::Recipient {
    age::scrypt::Recipient::new(age::secrecy::SecretString::from(passphrase.to_owned()))
}

// -- the request shape -------------------------------------------------------

/// What the caller sends to build a proposal.
#[derive(Debug, Deserialize)]
pub struct BuildRequest {
    /// The fund's policy file, verbatim.
    pub policy: serde_json::Value,
    /// The outputs to spend, whole. The caller has already made the
    /// selection and has already explained it to the person pressing the
    /// button.
    pub utxos: Vec<UtxoEntry>,
    /// Where the money goes: a shielded SWARM address.
    pub recipient: String,
    /// The memo carried with the note.
    #[serde(default)]
    pub memo: String,
    /// The transaction's expiry height.
    pub expiry_height: u32,
    /// The approved fee, or `null` for the ZIP-317 conventional fee.
    #[serde(default)]
    pub fee: Option<u64>,
    /// The network upgrade the transaction is built under, as
    /// `swarm_treasury::shielded::Pool::parse` spells it: `nu6_3` (the
    /// mainnet case, paying into the Ironwood pool) or `nu5`. Absent means
    /// `nu6_3`.
    #[serde(default)]
    pub pool: Option<String>,
}

// -- the work ----------------------------------------------------------------

/// Reads a signer backup's public record without ever handing back the secret.
pub fn signer_import(age_hex: &str, passphrase: &str) -> Result<String> {
    let bytes = hex::decode(age_hex.trim())
        .map_err(|error| fail("the signer file is not the bytes this build was given", error))?;
    let passphrase = Passphrase::new(passphrase).map_err(|error| fail("passphrase", error))?;
    let secret = signer::decrypt_backup(&bytes, &passphrase)
        .map_err(|error| fail("the signer file did not open", error))?;
    // `decrypt_backup` already recomputed the public key from the scalar, so
    // the record below cannot describe a key the file does not hold.
    let public = secret.public();
    serde_json::to_string(&public).map_err(|error| fail("could not write the signer record", error))
}

/// Verifies a policy file and returns everything it commits to.
pub fn policy_verify(policy_json: &str) -> Result<String> {
    let checked = checked_policy(policy_json)?;
    let answer = serde_json::json!({
        "fund": checked.policy.fund,
        "network": checked.policy.network,
        "threshold": checked.policy.threshold,
        "signers": checked.policy.signers,
        "redeem_script": checked.policy.redeem_script,
        "lock_script": hex::encode(&checked.lock_script),
        "script_hash": checked.policy.script_hash,
        "address": checked.policy.address,
        "policy_fingerprint": checked.policy.policy_fingerprint,
        "created": checked.policy.created,
    });
    serde_json::to_string(&answer).map_err(|error| fail("could not write the policy record", error))
}

/// The P2SH locking script a fund's outputs must be under, hex.
///
/// The caller hands it to the indexer query so an answer for some other
/// address is caught rather than shown.
pub fn policy_lock_script(policy_json: &str) -> Result<String> {
    Ok(hex::encode(checked_policy(policy_json)?.lock_script))
}

/// Builds a disbursement proposal: whole selected outputs, no change, one
/// shielded note to the recipient.
pub fn proposal_build(request_json: &str) -> Result<String> {
    let request: BuildRequest = serde_json::from_str(request_json)
        .map_err(|error| fail("this is not a proposal request", error))?;

    let policy_json = serde_json::to_string(&request.policy)
        .map_err(|error| fail("could not read the policy out of the request", error))?;
    let checked = checked_policy(&policy_json)?;

    let file = UtxoFile {
        schema: utxo::UTXO_SCHEMA.to_string(),
        schema_version: utxo::UTXO_SCHEMA_VERSION,
        network: checked.policy.network.clone(),
        utxos: request.utxos,
    };
    let selected = utxo::select_all(&file, &checked.lock_script, &checked.policy.network)
        .map_err(|error| fail("the selected outputs were refused", error))?;

    let pool = match request.pool.as_deref() {
        None => Pool::V6Ironwood,
        Some(name) => Pool::parse(name).map_err(|error| fail("pool", error))?,
    };
    let recipient = shielded::parse_recipient(&request.recipient, checked.network)
        .map_err(|error| fail("the recipient was refused", error))?;

    let mut rng_seed = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut rng_seed);

    let proposal = spend::propose(spend::ProposalRequest {
        policy: &checked,
        selected: &selected,
        recipient_text: &request.recipient,
        recipient,
        memo_text: &request.memo,
        fee: request.fee,
        expiry_height: request.expiry_height,
        pool,
        rng_seed,
    })
    .map_err(|error| fail("the proposal was refused", error))?;

    serde_json::to_string(&proposal).map_err(|error| fail("could not write the proposal", error))
}

/// The summary a signer reads before signing, and the numbers behind it.
pub fn proposal_summary(proposal_json: &str, policy_json: &str) -> Result<String> {
    let policy = checked_policy(policy_json)?;
    let (proposal, checked) = checked_proposal(proposal_json, &policy)?;
    let lines = spend::summary(&checked, &policy);
    let answer = serde_json::json!({
        "lines": lines,
        "proposal_hash": proposal.proposal_hash,
        "fund": proposal.fund,
        "network": proposal.network,
        "network_upgrade": proposal.network_upgrade,
        "policy_address": proposal.policy_address,
        "policy_fingerprint": proposal.policy_fingerprint,
        "recipient": proposal.recipient,
        "recipient_raw_receiver": proposal.recipient_raw_receiver,
        "memo": proposal.memo,
        "total_in": proposal.total_in,
        "fee": proposal.fee,
        "conventional_fee": proposal.conventional_fee,
        "amount_out": proposal.amount_out,
        "expiry_height": proposal.expiry_height,
        "inputs": proposal.inputs,
        "created": proposal.created,
        "threshold": policy.policy.threshold,
        "signer_fingerprints": policy
            .policy
            .signers
            .iter()
            .map(|s| s.fingerprint.clone())
            .collect::<Vec<_>>(),
    });
    serde_json::to_string(&answer).map_err(|error| fail("could not write the summary", error))
}

/// Signs every input of a checked proposal with one machine's signer.
pub fn proposal_sign(
    proposal_json: &str,
    policy_json: &str,
    signer_age_hex: &str,
    passphrase: &str,
) -> Result<String> {
    let policy = checked_policy(policy_json)?;
    let (_, checked) = checked_proposal(proposal_json, &policy)?;

    let bytes = hex::decode(signer_age_hex.trim())
        .map_err(|error| fail("the stored signer file is not readable", error))?;
    let passphrase = Passphrase::new(passphrase).map_err(|error| fail("passphrase", error))?;
    let secret = signer::decrypt_backup(&bytes, &passphrase)
        .map_err(|error| fail("the signer file did not open", error))?;

    let signature =
        spend::sign(&checked, &policy, &secret).map_err(|error| fail("signing was refused", error))?;
    serde_json::to_string(&signature).map_err(|error| fail("could not write the signature", error))
}

/// Combines threshold signatures into a transaction the network will take.
pub fn signatures_combine(
    proposal_json: &str,
    policy_json: &str,
    signatures_json: &str,
) -> Result<String> {
    let policy = checked_policy(policy_json)?;
    let (_, checked) = checked_proposal(proposal_json, &policy)?;
    let signatures: Vec<SignatureFile> = serde_json::from_str(signatures_json)
        .map_err(|error| fail("these are not swarm-treasury signature files", error))?;

    let combined = spend::combine(&checked, &policy, &signatures)
        .map_err(|error| fail("combining was refused", error))?;

    let answer = serde_json::json!({
        "raw_hex": combined.raw_hex,
        "txid": combined.record.txid,
        "record": combined.record,
    });
    serde_json::to_string(&answer)
        .map_err(|error| fail("could not write the combined transaction", error))
}

/// Encrypts a blob for the relay with the session code.
pub fn seal(passphrase: &str, plaintext: &str) -> Result<String> {
    if passphrase.trim().is_empty() {
        return Err(refuse("the session code must not be empty"));
    }
    let recipient = scrypt_recipient(passphrase);
    let ciphertext = age::encrypt(&recipient, plaintext.as_bytes())
        .map_err(|error| fail("could not seal the blob", error))?;
    Ok(hex::encode(ciphertext))
}

/// Decrypts a blob from the relay with the session code.
pub fn unseal(passphrase: &str, ciphertext_hex: &str) -> Result<String> {
    if passphrase.trim().is_empty() {
        return Err(refuse("the session code must not be empty"));
    }
    let bytes = hex::decode(ciphertext_hex.trim())
        .map_err(|error| fail("the relay returned something that is not a sealed blob", error))?;
    let identity =
        age::scrypt::Identity::new(age::secrecy::SecretString::from(passphrase.to_owned()));
    let plaintext = age::decrypt(&identity, &bytes).map_err(|error| {
        fail(
            "that session code does not open this blob (wrong code, or the blob was modified)",
            error,
        )
    })?;
    String::from_utf8(plaintext).map_err(|error| fail("the blob is not text", error))
}

/// Normalises a six-word session code: lower case, single spaces, no edges.
///
/// The renderer normalises identically (`normaliseSessionCode` in
/// `src/treasury/sessionCode.ts`). Both sides must agree, or the second
/// machine fetches from a path the first never wrote to.
pub fn normalise_code(code: &str) -> String {
    code.split_whitespace()
        .map(str::to_lowercase)
        .collect::<Vec<_>>()
        .join(" ")
}

/// The relay path a session lives at: a domain-separated, iterated hash of
/// its code.
pub fn session_id(code: &str) -> Result<String> {
    let normalised = normalise_code(code);
    if normalised.is_empty() {
        return Err(refuse("the session code must not be empty"));
    }
    let mut digest = {
        let mut hasher = Sha256::new();
        hasher.update(SESSION_ID_DOMAIN.as_bytes());
        hasher.update(normalised.as_bytes());
        hasher.finalize()
    };
    for _ in 1..SESSION_ID_ROUNDS {
        let mut hasher = Sha256::new();
        hasher.update(SESSION_ID_DOMAIN.as_bytes());
        hasher.update(digest);
        digest = hasher.finalize();
    }
    Ok(hex::encode(digest))
}

// -- tests -------------------------------------------------------------------
//
// These run against the published fixture scalars — the disposable test
// vectors 1, 2 and 3, which must never be funded — and against a policy,
// proposal and signature set they build themselves. They are the checks
// tasks T1 and T3 make of the crate, made again through the window this
// crate opens, because a binding that compiles is not a binding that signs.

#[cfg(test)]
mod tests {
    use super::*;
    use swarm_treasury::{network::TreasuryNetwork, policy::Fund, script, signer::SignerPublic};

    /// The disposable passphrase the fixture backups use.
    const PASSPHRASE: &str = "fixture passphrase, never used for anything real";
    /// A small scrypt work factor: the suite is not a key-derivation benchmark.
    const TEST_LOG_N: u8 = 10;

    /// The three published fixture public keys: secp256k1 scalars 1, 2 and 3.
    const FIXTURE_KEYS: [(&str, &str); 3] = [
        (
            "A",
            "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        ),
        (
            "B",
            "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
        ),
        (
            "C",
            "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
        ),
    ];

    fn fixture_policy_json() -> String {
        let publics: Vec<SignerPublic> = FIXTURE_KEYS
            .iter()
            .map(|(label, key)| {
                let parsed = script::parse_public_key(key).expect("a fixture key parses");
                SignerPublic {
                    schema: signer::PUBLIC_SCHEMA.to_string(),
                    schema_version: signer::SIGNER_SCHEMA_VERSION,
                    tool: swarm_treasury::TOOL_NAME.to_string(),
                    tool_version: swarm_treasury::TOOL_VERSION.to_string(),
                    label: (*label).to_string(),
                    public_key: (*key).to_string(),
                    fingerprint: signer::fingerprint(&parsed),
                    created: "2026-09-25T00:00:00Z".to_string(),
                }
            })
            .collect();
        let policy = policy::assemble(Fund::Core, TreasuryNetwork::Testnet, 2, &publics)
            .expect("the fixture policy assembles");
        serde_json::to_string(&policy).expect("the policy serialises")
    }

    /// The published fixture scalars reproduce the published script hash and
    /// address, through this crate's own `policy_verify`.
    #[test]
    fn fixture_policy_reproduces_the_published_script_hash() {
        let answer = policy_verify(&fixture_policy_json()).expect("the fixture policy verifies");
        let parsed: serde_json::Value = serde_json::from_str(&answer).expect("json");
        assert_eq!(
            parsed["script_hash"], "15fc0754e73eb85d1cbce08786fadb7320ecb8dc",
            "the binding must reproduce the published 2-of-3 script hash"
        );
        assert_eq!(parsed["address"], "t28Z45qZRaD6zXBMFHTzEN7pZfGeZTtbkFp");
        assert_eq!(parsed["threshold"], 2);
        assert_eq!(parsed["fund"], "Core");
    }

    /// A policy whose recorded address was edited is refused, not repaired.
    #[test]
    fn an_edited_policy_is_refused() {
        let mut parsed: serde_json::Value =
            serde_json::from_str(&fixture_policy_json()).expect("json");
        parsed["address"] = serde_json::Value::String("t1EdItEdEdItEdEdItEdEdItEdEdItEdItE".into());
        let edited = serde_json::to_string(&parsed).expect("json");
        assert!(policy_verify(&edited).is_err());
    }

    /// A signer backup opens with its passphrase and never yields the scalar.
    #[test]
    fn a_signer_backup_opens_without_handing_over_the_secret() {
        let secret = signer::generate("A").expect("a key is generated");
        let passphrase = Passphrase::new(PASSPHRASE).expect("passphrase");
        let backup = signer::encrypt_backup_with(&secret, &passphrase, Some(TEST_LOG_N))
            .expect("the backup encrypts");

        let answer = signer_import(&hex::encode(&backup), PASSPHRASE).expect("the backup opens");
        assert!(
            !answer.contains(&secret.secret_key),
            "the secret scalar must never cross the boundary"
        );
        let parsed: serde_json::Value = serde_json::from_str(&answer).expect("json");
        assert_eq!(parsed["label"], "A");
        assert_eq!(parsed["public_key"], secret.public_key);
        assert_eq!(parsed["fingerprint"], secret.fingerprint);

        assert!(
            signer_import(&hex::encode(&backup), "the wrong passphrase").is_err(),
            "a wrong passphrase must refuse, not return an empty record"
        );
    }

    /// Sealing and unsealing a relay blob round trips, and the wrong code
    /// fails loudly rather than returning something plausible.
    #[test]
    fn a_relay_blob_round_trips_under_its_session_code() {
        let code = "bala dote koba nemi rate vibo";
        let plaintext = r#"{"kind":"proposal","proposal":{"hello":"world"}}"#;
        let sealed = seal(code, plaintext).expect("seals");
        assert_ne!(sealed, hex::encode(plaintext), "the blob must be encrypted");
        assert!(
            !sealed.contains(&hex::encode("proposal")),
            "the relay must not be able to see the blob's shape"
        );
        assert_eq!(unseal(code, &sealed).expect("unseals"), plaintext);
        assert!(unseal("bala dote koba nemi rate mika", &sealed).is_err());
        assert!(seal("   ", plaintext).is_err());
    }

    /// The session id is stable, case- and spacing-insensitive, and is not
    /// the code itself.
    #[test]
    fn the_session_id_is_a_stable_domain_separated_hash() {
        let code = "bala dote koba nemi rate vibo";
        let id = session_id(code).expect("an id");
        assert_eq!(id.len(), 64);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(
            id,
            session_id("  Bala   DOTE koba nemi rate vibo ").expect("an id")
        );
        assert_ne!(
            id,
            session_id("bala dote koba nemi rate mika").expect("an id")
        );
        assert!(!id.contains(&hex::encode(code)));
        assert!(session_id("   ").is_err());
    }

    /// The whole flow, through this crate only: build a proposal from a
    /// fixture collector output, sign it on two "machines", combine, and get
    /// a transaction the script interpreter accepted — `spend::combine` runs
    /// it.
    #[test]
    fn two_machines_sign_a_proposal_and_the_combiner_accepts_it() {
        // Three signers, their backups, and the 2-of-3 policy they form.
        let secrets: Vec<_> = ["A", "B", "C"]
            .iter()
            .map(|label| signer::generate(label).expect("a key is generated"))
            .collect();
        let passphrase = Passphrase::new(PASSPHRASE).expect("passphrase");
        let backups: Vec<String> = secrets
            .iter()
            .map(|secret| {
                hex::encode(
                    signer::encrypt_backup_with(secret, &passphrase, Some(TEST_LOG_N))
                        .expect("encrypts"),
                )
            })
            .collect();
        let publics: Vec<_> = secrets.iter().map(|s| s.public()).collect();
        let policy = policy::assemble(Fund::Core, TreasuryNetwork::Testnet, 2, &publics)
            .expect("the policy assembles");
        let policy_json = serde_json::to_string(&policy).expect("json");
        let checked = policy::verify(&policy).expect("verifies");

        // One mature collector output, locked to the policy.
        let recipient_key =
            shielded::fixture_spending_key([0u8; 32]).expect("the fixture spending key");
        let recipient = shielded::receiver_of_spending_key(&recipient_key);
        let request = serde_json::json!({
            "policy": serde_json::from_str::<serde_json::Value>(&policy_json).expect("json"),
            "utxos": [{
                "txid": "33".repeat(32),
                "vout": 0,
                "value": 1_000_000_000u64,
                "height": 3_000_000u32,
                "is_coinbase": true,
                "script": hex::encode(&checked.lock_script),
            }],
            "recipient": hex::encode(recipient.to_raw_address_bytes()),
            "memo": "SWARM treasury payout, from the Treasury page",
            "expiry_height": 3_000_500u32,
            "fee": serde_json::Value::Null,
            "pool": "nu6_3",
        });
        let proposal_json =
            proposal_build(&serde_json::to_string(&request).expect("json")).expect("builds");

        // The summary every screen shows, and the hash it shows it under.
        let summary_json = proposal_summary(&proposal_json, &policy_json).expect("summarises");
        let summary: serde_json::Value = serde_json::from_str(&summary_json).expect("json");
        let proposal: serde_json::Value = serde_json::from_str(&proposal_json).expect("json");
        assert_eq!(summary["proposal_hash"], proposal["proposal_hash"]);
        assert_eq!(summary["total_in"], 1_000_000_000u64);
        assert_eq!(
            summary["amount_out"].as_u64().expect("a number")
                + summary["fee"].as_u64().expect("a number"),
            1_000_000_000u64,
            "whole outputs, no change: in = out + fee"
        );
        assert_eq!(
            summary["signer_fingerprints"]
                .as_array()
                .expect("an array")
                .len(),
            3
        );

        // Two machines sign. Neither ever sees the other's signer file.
        let sig_a =
            proposal_sign(&proposal_json, &policy_json, &backups[0], PASSPHRASE).expect("A signs");
        let sig_c =
            proposal_sign(&proposal_json, &policy_json, &backups[2], PASSPHRASE).expect("C signs");

        // `spend::combine` runs the script interpreter over the result, so a
        // combine that returns at all is a transaction the interpreter took.
        let combined_json =
            signatures_combine(&proposal_json, &policy_json, &format!("[{sig_a},{sig_c}]"))
                .expect("combines");
        let combined: serde_json::Value = serde_json::from_str(&combined_json).expect("json");
        assert_eq!(combined["txid"].as_str().expect("a txid").len(), 64);
        assert!(combined["raw_hex"].as_str().expect("hex").len() > 128);

        // One signature is not two.
        assert!(
            signatures_combine(&proposal_json, &policy_json, &format!("[{sig_a}]")).is_err(),
            "a 2-of-3 policy must refuse a single signature"
        );

        // And the same signer twice is not two signers.
        assert!(
            signatures_combine(&proposal_json, &policy_json, &format!("[{sig_a},{sig_a}]"))
                .is_err(),
            "the same signature twice must not reach the threshold"
        );
    }

    /// A proposal whose recorded hash was edited is refused before anything
    /// is signed: this is the check every screen's "proposal hash" line
    /// stands on.
    #[test]
    fn a_proposal_with_a_forged_hash_is_refused() {
        let policy_json = fixture_policy_json();
        let policy =
            policy::verify(&serde_json::from_str::<Policy>(&policy_json).expect("json"))
                .expect("verifies");
        let recipient_key =
            shielded::fixture_spending_key([1u8; 32]).expect("the fixture spending key");
        let recipient = shielded::receiver_of_spending_key(&recipient_key);
        let request = serde_json::json!({
            "policy": serde_json::from_str::<serde_json::Value>(&policy_json).expect("json"),
            "utxos": [{
                "txid": "44".repeat(32),
                "vout": 0,
                "value": 500_000_000u64,
                "height": 3_000_000u32,
                "is_coinbase": true,
                "script": hex::encode(&policy.lock_script),
            }],
            "recipient": hex::encode(recipient.to_raw_address_bytes()),
            "memo": "",
            "expiry_height": 3_000_400u32,
            "pool": "nu6_3",
        });
        let proposal_json =
            proposal_build(&serde_json::to_string(&request).expect("json")).expect("builds");
        let mut parsed: serde_json::Value = serde_json::from_str(&proposal_json).expect("json");
        parsed["proposal_hash"] = serde_json::Value::String("00".repeat(32));
        let forged = serde_json::to_string(&parsed).expect("json");

        let error = proposal_summary(&forged, &policy_json)
            .expect_err("a forged hash must be refused")
            .to_string();
        assert!(
            error.contains("does not match its contents"),
            "the refusal must say what is wrong: {error}"
        );
        // And nothing signs it either.
        assert!(proposal_sign(&forged, &policy_json, "00", "anything").is_err());
    }

    /// An output that is not locked to the policy is refused at selection,
    /// before a proof is built for it.
    #[test]
    fn an_output_that_is_not_the_funds_is_refused() {
        let policy_json = fixture_policy_json();
        let request = serde_json::json!({
            "policy": serde_json::from_str::<serde_json::Value>(&policy_json).expect("json"),
            "utxos": [{
                "txid": "55".repeat(32),
                "vout": 0,
                "value": 100_000u64,
                "height": 3_000_000u32,
                "is_coinbase": true,
                "script": "a914000000000000000000000000000000000000000087",
            }],
            "recipient": "00".repeat(43),
            "memo": "",
            "expiry_height": 3_000_400u32,
        });
        let error = proposal_build(&serde_json::to_string(&request).expect("json"))
            .expect_err("an output of another address must be refused")
            .to_string();
        assert!(error.contains("not locked to the policy address"), "{error}");
    }

    /// The lock script the indexer query is checked against is derived, not
    /// read out of the file.
    #[test]
    fn the_lock_script_is_derived_from_the_policy() {
        let script = policy_lock_script(&fixture_policy_json()).expect("a lock script");
        assert_eq!(script, "a91415fc0754e73eb85d1cbce08786fadb7320ecb8dc87");
    }
}
