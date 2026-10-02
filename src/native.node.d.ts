import { PerformanceLevelEnum } from "./components/appstate";

/**
 * What the addon's first argument actually is: a chain HINT, not a chain label.
 *
 * It was typed `ServerChainNameEnum`, and that type was the bug. For `main`,
 * `test`, `regtest` and `swarm-testnet` the hint and the label happen to be
 * the same string, so the type was true by coincidence for four years. SWARM
 * production broke the coincidence — its hint is `swarm-mainnet:<64 hex>`,
 * because `ChainType::SwarmMainnet` carries the genesis and the SDK gives it
 * no default — and the old type then made every call site that passed a bare
 * label typecheck cleanly. The owner met the result on 2026-09-26:
 *
 *   initializing wallet: 'swarm-mainnet' does not name a network.
 *
 * Typed as a plain string so nothing can pass a label here believing the
 * compiler checked it. Build the value with `nativeChainHint` in
 * src/utils/networkProfiles.ts; `src/utils/nativeChainHint.test.ts` fails the
 * build if a call site does anything else.
 */
export type SwarmChainHint = string;

export function deinitialize(): string;
export function wallet_exists(
  server_uri: string,
  chain_hint: SwarmChainHint,
  performance_level: PerformanceLevelEnum,
  min_confirmations: number,
  wallet_name: string,
): boolean;
export function init_new(
  server_uri: string,
  chain_hint: SwarmChainHint,
  performance_level: PerformanceLevelEnum,
  min_confirmations: number,
  wallet_name: string,
): string;
export function init_from_seed(
  seed: string,
  birthday: number,
  server_uri: string,
  chain_hint: SwarmChainHint,
  performance_level: PerformanceLevelEnum,
  min_confirmations: number,
  wallet_name: string,
): string;
export function init_from_ufvk(
  ufvk: string,
  birthday: number,
  server_uri: string,
  chain_hint: SwarmChainHint,
  performance_level: PerformanceLevelEnum,
  min_confirmations: number,
  wallet_name: string,
): string;
export function init_from_b64(
  server_uri: string,
  chain_hint: SwarmChainHint,
  performance_level: PerformanceLevelEnum,
  min_confirmations: number,
  wallet_name: string,
): string;
/**
 * Moves a SWARM Mainnet wallet file written on the abandoned chain (genesis
 * 01c34428…) onto the restarted one: same keys and addresses, birthday at the
 * new chain's first block, none of the old chain's state, and a byte-identical
 * backup of the old file beside it. Offline. Answers JSON: backup_path,
 * previous_birthday, birthday, key_kind, unified_addresses,
 * transparent_addresses, transparent_other_scopes.
 */
export function move_wallet_to_restarted_chain(
  chain_hint: SwarmChainHint,
  performance_level: PerformanceLevelEnum,
  min_confirmations: number,
  wallet_name: string,
): string;
export function save_wallet_file(): Promise<string>;
export function check_save_error(): Promise<string>;
export function get_developer_donation_address(): string;
export function get_zennies_for_zingo_donation_address(): string;
export function set_crypto_default_provider_to_ring(): string;
export function get_seed(): Promise<string>;
export function get_ufvk(): Promise<string>;
export function get_latest_block_server(server_uri: string): Promise<string>;
export function get_latest_block_wallet(): Promise<string>;
export function get_value_transfers(): Promise<string>;
export function poll_sync(): Promise<string>;
export function run_sync(): Promise<string>;
export function pause_sync(): Promise<string>;
export function stop_sync(): Promise<string>;
export function status_sync(): Promise<string>;
export function run_rescan(): Promise<string>;
export function info_server(): Promise<string>;
export function change_server(server_uri: string): Promise<string>;
export function wallet_kind(): Promise<string>;
export function parse_address(address: string): Promise<string>;
export function parse_ufvk(ufvk: string): Promise<string>;
export function get_version(): Promise<string>;
export function get_messages(address: string): Promise<string>;
export function get_balance(): Promise<string>;
export function get_total_memobytes_to_address(): Promise<string>;
export function get_total_value_to_address(): Promise<string>;
export function get_total_spends_to_address(): Promise<string>;
export function zec_price_over_mixnet(): Promise<string>;
export function mixnet_status(): Promise<string>;
export function attach_mixnet(socks5_addr: string, exits: string[]): Promise<string>;
export function stop_mixnet(): Promise<string>;
export function remove_transaction(txid: string): Promise<string>;
export function get_spendable_balance_with_address(address: string, zennies: string): Promise<string>;
export function get_spendable_balance_total(): Promise<string>;
export function set_option_wallet(): Promise<string>;
export function get_unified_addresses(): Promise<string>;
export function get_transparent_addresses(): Promise<string>;
export function create_new_unified_address(receivers: string): Promise<string>;
export function create_new_transparent_address(): Promise<string>;
export function derive_refund_address(): Promise<string>;
export function reserve_refund_address(): Promise<string>;
export function get_wallet_save_required(): Promise<string>;
export function set_config_wallet_to_test(): Promise<string>;
export function set_config_wallet_to_prod(performance_level: string, min_confirmations: number): Promise<string>;
export function get_config_wallet_performance(): Promise<string>;
export function get_wallet_version(): Promise<string>;
export function send(send_json: string): Promise<string>;
export function send_swap_deposit(vault_address: string, amount: number, memo_hex: string): Promise<string>;
export function shield(): Promise<string>;
export function confirm(): Promise<string>;
export function drain_orchard_to_ironwood(): Promise<string>;
export function drain_status(): Promise<string>;
export function get_ironwood_activation_height(): Promise<string>;
export function plan_orchard_drain(): Promise<string>;
// Private (scheduled) Ironwood migration — zingolib parts/buckets engine.
export function plan_ironwood_migration(): Promise<string>;
export function start_ironwood_migration(consented_plan_hash: string, per_bucket: number): Promise<string>;
export function continue_note_splitting(): Promise<string>;
export function reschedule_parts(per_bucket: number): Promise<string>;
export function migration_status(): Promise<string>;
export function reconcile_migration(): Promise<string>;
export function broadcast_due_parts(): Promise<string>;
export function auto_broadcast_if_due(): Promise<string>;
export function catch_up_migration(): Promise<string>;
export function migrate_to_ironwood(): Promise<string>;
export function cancel_ironwood_migration(): Promise<string>;
export function execute_due_parts(spacing_ms: number): Promise<string>;
export function execute_due_parts_status(): Promise<string>;
export function delete_wallet(
  server_uri: string,
  chain_hint: SwarmChainHint,
  performance_level: PerformanceLevelEnum,
  min_confirmations: number,
  wallet_name: string,
): Promise<string>;

// -- the 2-of-3 treasury custody surface -------------------------------------
//
// Every one of these is a window onto the `swarm-treasury` crate, which is
// the same code the offline command-line ceremony runs. Strings of JSON in,
// strings of JSON out, like everything else here. See src/treasury/ for the
// typed layer over them and docs/TREASURY.md for the ceremony.
//
// Two things never come back out: the signer's secret scalar (the
// `.signer.age` bytes stay encrypted, and this app stores them exactly as it
// received them) and the passphrase (passed in for one call and dropped at
// the end of it).

/** Opens a `.signer.age` backup just far enough to read its public record. */
export function treasury_signer_import(age_hex: string, passphrase: string): Promise<string>;
/** Recomputes everything a policy file claims, and refuses if it lied. */
export function treasury_policy_verify(policy_json: string): Promise<string>;
/** Builds a disbursement proposal: whole outputs, no change, one shielded note. */
export function treasury_proposal_build(request_json: string): Promise<string>;
/** The summary a signer reads, and the numbers behind it. */
export function treasury_proposal_summary(proposal_json: string, policy_json: string): Promise<string>;
/** Signs every input with one machine's signer. The passphrase is used once. */
export function treasury_proposal_sign(
  proposal_json: string,
  policy_json: string,
  signer_age_hex: string,
  passphrase: string,
): Promise<string>;
/** Combines threshold signatures and runs the script interpreter over the result. */
export function treasury_signatures_combine(
  proposal_json: string,
  policy_json: string,
  signatures_json: string,
): Promise<string>;
/** Asks the indexer what a fund's address holds, with heights and maturity. */
export function treasury_utxos_from_lightwalletd(
  server_uri: string,
  address: string,
  lock_script_hex: string,
): Promise<string>;
/** Hands a combined transaction to the network with `SendTransaction`. */
export function treasury_broadcast(server_uri: string, raw_hex: string): Promise<string>;
/** Seals a relay blob under the session code (`age`, scrypt recipient). */
export function treasury_seal(passphrase: string, plaintext: string): Promise<string>;
/** Opens a relay blob sealed under the session code. */
export function treasury_unseal(passphrase: string, ciphertext_hex: string): Promise<string>;
/** The relay path a session lives at: a domain-separated hash of its code. */
export function treasury_session_id(code: string): string;
