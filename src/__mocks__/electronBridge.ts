// Exactly the functions `public/preload.js` puts on
// `window.electronAPI.native`, and no others. `src/nativeSurface.test.ts`
// holds this against that list: a mock with a function the real bridge does
// not have is a mock that hides a Treasury-page-shaped hole. Three names were
// removed on 2026-09-27 for that reason — `set_wallet_base_dir` and
// `start_security_scoped_access` are main-process-only by design, and
// `get_total_number_of_sends` was called from nowhere at all.
export const native = {
  parse_address: jest.fn(),
  get_seed: jest.fn(),
  get_ufvk: jest.fn(),
  // LoadingScreen
  wallet_exists: jest.fn(),
  wallet_kind: jest.fn(),
  init_from_b64: jest.fn(),
  move_wallet_to_restarted_chain: jest.fn(),
  init_new: jest.fn(),
  // The chain a freshly built wallet's server says it serves. AddNewWallet
  // reads it before the wallet is registered; see
  // `assertServerServesSelectedChain`.
  info_server: jest.fn(),
  set_crypto_default_provider_to_ring: jest.fn(),
  get_latest_block_server: jest.fn(),
  // AddNewWallet (delete)
  stop_sync: jest.fn(),
  delete_wallet: jest.fn(),
  // Send
  send: jest.fn(),
  get_spendable_balance_with_address: jest.fn(),
  // History
  remove_transaction: jest.fn(),
  // Swap
  send_swap_deposit: jest.fn(),
  derive_refund_address: jest.fn(),
  reserve_refund_address: jest.fn(),
  // Insight
  get_total_value_to_address: jest.fn(),
  get_total_spends_to_address: jest.fn(),
  get_total_memobytes_to_address: jest.fn(),
  // Treasury. Every one of these is a window onto the swarm-treasury crate;
  // a test that needs a real answer from one of them belongs in the addon's
  // own suite (native/src/treasury.rs), not here.
  treasury_signer_import: jest.fn(),
  treasury_policy_verify: jest.fn(),
  treasury_proposal_build: jest.fn(),
  treasury_proposal_summary: jest.fn(),
  treasury_proposal_sign: jest.fn(),
  treasury_signatures_combine: jest.fn(),
  treasury_utxos_from_lightwalletd: jest.fn(),
  treasury_broadcast: jest.fn(),
  treasury_seal: jest.fn(),
  treasury_unseal: jest.fn(),
  treasury_session_id: jest.fn(),
};

export const clipboard = {
  writeText: jest.fn(),
};

export const shell = {
  openExternal: jest.fn(),
  openPaymentUri: jest.fn(async () => ({ ok: true })),
};

export const ipcRenderer = {
  // Returns a disposer, as the real bridge does: the preload owns the
  // registration because contextBridge proxies anything named from this side.
  // A mock that returned nothing would let a component forget to unsubscribe
  // and still pass.
  on: jest.fn(() => jest.fn()),
  invoke: jest.fn(),
  send: jest.fn(),
};

export const fs = {
  promises: { readFile: jest.fn(), writeFile: jest.fn() },
  existsSync: jest.fn(),
};

export const isSandboxed = false;
