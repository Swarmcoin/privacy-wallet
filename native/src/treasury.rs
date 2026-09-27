//! The Neon glue for the treasury custody surface.
//!
//! The work is in `swarm-wallet-treasury-core`, the crate beside this one,
//! which has no Node in it and can therefore be tested — see its own
//! documentation and its own suite. What is here is the boundary: arguments
//! off the JavaScript stack, work on tokio's blocking pool, a string of JSON
//! back.
//!
//! One function does live here, because it cannot live there: reading a
//! fund's unspent outputs off the indexer. It needs this crate's gRPC client
//! and this crate's tokio runtime, and the custody tool is deliberately
//! offline — it opens no socket and knows no chain.

use std::time::Duration;

use neon::prelude::*;
use serde::Serialize;
use swarm_wallet_treasury_core as treasury;

use zingo_netutils::lightwallet_protocol::{GetAddressUtxosArg, TxFilter};
use zingo_netutils::{GrpcIndexer, Indexer, TransparentIndexer};

use crate::ZingolibError;

/// How long one indexer request may take.
///
/// The same thirty seconds the rest of this addon gives the indexer, so a
/// treasury screen that is waiting is waiting for the same reason every
/// other screen would be.
const INDEXER_TIMEOUT: Duration = Duration::from_secs(30);

/// The most outputs one screen will fetch the full transaction for.
///
/// `GetAddressUtxos` does not say whether an output is a coinbase output, so
/// each one costs a `GetTransaction`. A fund with more unspent outputs than
/// this is a fund that needs the command-line tool and a human, not a page
/// that quietly asks the indexer nine hundred times.
const MAX_UTXOS: usize = 200;

/// Every refusal from the core crate arrives on screen verbatim.
fn lift(error: treasury::TreasuryError) -> ZingolibError {
    ZingolibError::Treasury(error.0)
}

fn fail(context: &str, error: impl std::fmt::Display) -> ZingolibError {
    ZingolibError::Treasury(format!("{context}: {error}"))
}

fn refuse(message: impl Into<String>) -> ZingolibError {
    ZingolibError::Treasury(message.into())
}

// -- the one thing that needs a network --------------------------------------

/// One unspent output as the treasury screen shows it.
#[derive(Debug, Serialize)]
struct LiveUtxo {
    txid: String,
    vout: u32,
    value: u64,
    height: u32,
    is_coinbase: bool,
    script: String,
    confirmations: u32,
    mature: bool,
}

/// What [`utxos_from_lightwalletd`] answers.
#[derive(Debug, Serialize)]
struct LiveUtxos {
    address: String,
    chain_height: u32,
    coinbase_maturity: u32,
    mature_total: u64,
    immature_total: u64,
    utxos: Vec<LiveUtxo>,
    truncated: bool,
}

/// Asks the indexer what a fund's address holds.
///
/// `GetAddressUtxos` is a lightwalletd call every Zaino serves, and it needs
/// no node RPC and no wallet: the fund's address is not this wallet's
/// address, and this build has no business importing it as one.
fn utxos_from_lightwalletd(
    server_uri: &str,
    address: &str,
    lock_script_hex: &str,
) -> Result<String, ZingolibError> {
    let uri: http::Uri = server_uri
        .parse()
        .map_err(|error| fail("that is not a server address", error))?;
    let expected_script = lock_script_hex.trim().to_lowercase();
    let address = address.to_owned();

    crate::RT.block_on(async move {
        let mut indexer = GrpcIndexer::new(uri)
            .await
            .map_err(|error| fail("could not reach the indexer", error))?;

        let tip = indexer
            .get_latest_block(INDEXER_TIMEOUT)
            .await
            .map_err(|error| fail("the indexer did not answer with a height", error))?;
        let chain_height = u32::try_from(tip.height)
            .map_err(|_| refuse("the indexer reported an impossible chain height"))?;

        let reply = indexer
            .get_address_utxos(
                GetAddressUtxosArg {
                    addresses: vec![address.clone()],
                    start_height: 0,
                    max_entries: 0,
                },
                INDEXER_TIMEOUT,
            )
            .await
            .map_err(|error| fail("the indexer refused the UTXO request", error))?;

        let all = reply.address_utxos;
        let truncated = all.len() > MAX_UTXOS;
        let mut utxos = Vec::with_capacity(all.len().min(MAX_UTXOS));
        let mut mature_total: u64 = 0;
        let mut immature_total: u64 = 0;

        for entry in all.into_iter().take(MAX_UTXOS) {
            let script = hex::encode(&entry.script);
            if script != expected_script {
                // The indexer answered with an output that is not locked to
                // this policy. Nothing good follows from guessing.
                return Err(refuse(format!(
                    "the indexer returned an output that is not locked to this fund: \
                     its script is {script}, the policy's is {expected_script}",
                )));
            }
            // `GetAddressUtxos` reports the txid in internal byte order;
            // every human-facing surface, and every swarm-treasury file,
            // uses the display order a block explorer prints.
            let mut display = entry.txid.clone();
            display.reverse();
            let txid = hex::encode(&display);

            let height = u32::try_from(entry.height)
                .map_err(|_| refuse("the indexer reported an impossible output height"))?;
            let value = u64::try_from(entry.value_zat)
                .map_err(|_| refuse("the indexer reported a negative output value"))?;
            let vout = u32::try_from(entry.index)
                .map_err(|_| refuse("the indexer reported a negative output index"))?;

            let is_coinbase = transaction_is_coinbase(&mut indexer, &entry.txid).await?;
            let confirmations = chain_height.saturating_sub(height).saturating_add(1);
            let mature = if is_coinbase {
                confirmations >= treasury::COINBASE_MATURITY
            } else {
                confirmations >= 1
            };
            if mature {
                mature_total = mature_total.saturating_add(value);
            } else {
                immature_total = immature_total.saturating_add(value);
            }

            utxos.push(LiveUtxo {
                txid,
                vout,
                value,
                height,
                is_coinbase,
                script,
                confirmations,
                mature,
            });
        }

        // Largest first, then oldest first, then by outpoint: the same order
        // the renderer's selection rule walks (`selectionOrder` in
        // src/treasury/selectUtxos.ts), so what the screen explains and what
        // the proposal spends cannot drift apart.
        utxos.sort_by(|a, b| {
            b.value
                .cmp(&a.value)
                .then(a.height.cmp(&b.height))
                .then(a.txid.cmp(&b.txid))
                .then(a.vout.cmp(&b.vout))
        });

        let answer = LiveUtxos {
            address,
            chain_height,
            coinbase_maturity: treasury::COINBASE_MATURITY,
            mature_total,
            immature_total,
            utxos,
            truncated,
        };
        serde_json::to_string(&answer).map_err(|error| fail("could not write the UTXO list", error))
    })
}

/// Whether the transaction an output came from is a coinbase transaction.
///
/// The lightwalletd UTXO reply does not carry it, and it decides both
/// whether the output needs a hundred confirmations and what the proposal
/// records. It is read off the transaction itself rather than assumed from
/// the fact that treasury collector outputs happen to be coinbase outputs.
async fn transaction_is_coinbase(
    indexer: &mut GrpcIndexer,
    txid_internal: &[u8],
) -> Result<bool, ZingolibError> {
    let raw = indexer
        .get_transaction(
            TxFilter {
                block: None,
                index: 0,
                hash: txid_internal.to_vec(),
            },
            INDEXER_TIMEOUT,
        )
        .await
        .map_err(|error| fail("the indexer would not show the funding transaction", error))?;

    use zebra_chain::serialization::ZcashDeserializeInto;
    let transaction: zebra_chain::transaction::Transaction = raw
        .data
        .as_slice()
        .zcash_deserialize_into()
        .map_err(|error| fail("the funding transaction did not parse", error))?;
    Ok(transaction.is_coinbase())
}

// -- the Neon surface --------------------------------------------------------

fn js_signer_import(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let age_hex = cx.argument::<JsString>(0)?.value(&mut cx);
    let passphrase = cx.argument::<JsString>(1)?.value(&mut cx);
    crate::spawn_promise(&mut cx, move || {
        treasury::signer_import(&age_hex, &passphrase).map_err(lift)
    })
}

fn js_policy_verify(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let policy_json = cx.argument::<JsString>(0)?.value(&mut cx);
    crate::spawn_promise(&mut cx, move || {
        treasury::policy_verify(&policy_json).map_err(lift)
    })
}

fn js_proposal_build(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let request_json = cx.argument::<JsString>(0)?.value(&mut cx);
    crate::spawn_promise(&mut cx, move || {
        treasury::proposal_build(&request_json).map_err(lift)
    })
}

fn js_proposal_summary(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let proposal_json = cx.argument::<JsString>(0)?.value(&mut cx);
    let policy_json = cx.argument::<JsString>(1)?.value(&mut cx);
    crate::spawn_promise(&mut cx, move || {
        treasury::proposal_summary(&proposal_json, &policy_json).map_err(lift)
    })
}

fn js_proposal_sign(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let proposal_json = cx.argument::<JsString>(0)?.value(&mut cx);
    let policy_json = cx.argument::<JsString>(1)?.value(&mut cx);
    let signer_age_hex = cx.argument::<JsString>(2)?.value(&mut cx);
    let passphrase = cx.argument::<JsString>(3)?.value(&mut cx);
    crate::spawn_promise(&mut cx, move || {
        treasury::proposal_sign(&proposal_json, &policy_json, &signer_age_hex, &passphrase)
            .map_err(lift)
    })
}

fn js_signatures_combine(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let proposal_json = cx.argument::<JsString>(0)?.value(&mut cx);
    let policy_json = cx.argument::<JsString>(1)?.value(&mut cx);
    let signatures_json = cx.argument::<JsString>(2)?.value(&mut cx);
    crate::spawn_promise(&mut cx, move || {
        treasury::signatures_combine(&proposal_json, &policy_json, &signatures_json).map_err(lift)
    })
}

fn js_utxos_from_lightwalletd(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let server_uri = cx.argument::<JsString>(0)?.value(&mut cx);
    let address = cx.argument::<JsString>(1)?.value(&mut cx);
    let lock_script_hex = cx.argument::<JsString>(2)?.value(&mut cx);
    crate::spawn_promise(&mut cx, move || {
        utxos_from_lightwalletd(&server_uri, &address, &lock_script_hex)
    })
}

fn js_seal(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let passphrase = cx.argument::<JsString>(0)?.value(&mut cx);
    let plaintext = cx.argument::<JsString>(1)?.value(&mut cx);
    crate::spawn_promise(&mut cx, move || {
        treasury::seal(&passphrase, &plaintext).map_err(lift)
    })
}

fn js_unseal(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let passphrase = cx.argument::<JsString>(0)?.value(&mut cx);
    let ciphertext_hex = cx.argument::<JsString>(1)?.value(&mut cx);
    crate::spawn_promise(&mut cx, move || {
        treasury::unseal(&passphrase, &ciphertext_hex).map_err(lift)
    })
}

fn js_session_id(mut cx: FunctionContext) -> JsResult<JsString> {
    let code = cx.argument::<JsString>(0)?.value(&mut cx);
    match treasury::session_id(&code) {
        Ok(id) => Ok(cx.string(id)),
        Err(error) => cx.throw_error(error.0),
    }
}

/// Registers every treasury function on the addon.
pub(crate) fn register(cx: &mut ModuleContext) -> NeonResult<()> {
    cx.export_function("treasury_signer_import", js_signer_import)?;
    cx.export_function("treasury_policy_verify", js_policy_verify)?;
    cx.export_function("treasury_proposal_build", js_proposal_build)?;
    cx.export_function("treasury_proposal_summary", js_proposal_summary)?;
    cx.export_function("treasury_proposal_sign", js_proposal_sign)?;
    cx.export_function("treasury_signatures_combine", js_signatures_combine)?;
    cx.export_function("treasury_utxos_from_lightwalletd", js_utxos_from_lightwalletd)?;
    cx.export_function("treasury_seal", js_seal)?;
    cx.export_function("treasury_unseal", js_unseal)?;
    cx.export_function("treasury_session_id", js_session_id)?;
    Ok(())
}
