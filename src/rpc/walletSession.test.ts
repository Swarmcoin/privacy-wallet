import RPC from "./rpc";
import { native, ipcRenderer } from "../electronBridge";
import { WalletType } from "../components/appstate";

jest.mock("../electronBridge", () => ({
  native: {
    get_spendable_balance_total: jest.fn(),
    get_balance: jest.fn(),
    get_latest_block_server: jest.fn(),
    get_latest_block_wallet: jest.fn(),
    get_value_transfers: jest.fn(),
    poll_sync: jest.fn(),
    run_sync: jest.fn(),
  },
  ipcRenderer: { invoke: jest.fn(), on: jest.fn(() => () => {}), send: jest.fn() },
  clipboard: {},
  shell: {},
  fs: {},
  isSandboxed: false,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function client() {
  const balance = jest.fn(),
    transfers = jest.fn(),
    error = jest.fn();
  const noop = () => {};
  const rpc = new RPC(balance, noop, noop, transfers, noop, noop, noop, noop, noop, error, noop, noop, null);
  return { rpc, balance, transfers, error };
}
beforeEach(() => {
  jest.clearAllMocks();
  (native.get_spendable_balance_total as jest.Mock).mockResolvedValue('{"spendable_balance":100000000}');
  (native.get_balance as jest.Mock).mockResolvedValue('{"total_ironwood_balance":100000000}');
  (native.get_latest_block_server as jest.Mock).mockResolvedValue("100");
  (native.get_latest_block_wallet as jest.Mock).mockResolvedValue('{"height":100}');
});

it("keeps the last history when the native transfer read fails", async () => {
  const { rpc, transfers, error } = client();
  (native.get_value_transfers as jest.Mock).mockRejectedValueOnce(new Error("Lightclient lock poisoned"));
  await rpc.fetchTandZandOValueTransfers();
  expect(transfers).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith("ValueTransfers", expect.stringContaining("Lightclient lock poisoned"));
});

it.each(["", "{}", '{"value_transfers":null}', "not-json"])(
  "does not clear history for a malformed native response: %s", async (response) => {
    const { rpc, transfers, error } = client();
    (native.get_value_transfers as jest.Mock).mockResolvedValueOnce(response);
    await rpc.fetchTandZandOValueTransfers();
    expect(transfers).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("ValueTransfers", expect.any(String));
  },
);

it("still accepts a successfully loaded empty history", async () => {
  const { rpc, transfers, error } = client();
  (native.get_value_transfers as jest.Mock).mockResolvedValueOnce('{"value_transfers":[]}');
  await rpc.fetchTandZandOValueTransfers();
  expect(transfers).toHaveBeenCalledWith([]);
  expect(error).not.toHaveBeenCalled();
});

it("discards the previous wallet's balance after polling is stopped", async () => {
  const pending = deferred<string>();
  (native.get_balance as jest.Mock).mockReturnValueOnce(pending.promise);
  const { rpc, balance } = client();
  const read = rpc.fetchTotalBalance();
  await Promise.resolve();
  await rpc.clearTimers();
  pending.resolve('{"total_ironwood_balance":500000000000}');
  await read;
  expect(balance).not.toHaveBeenCalled();
});

it("does not combine the previous wallet's spendable amount with the next wallet's balance", async () => {
  const pending = deferred<string>();
  (native.get_spendable_balance_total as jest.Mock).mockReturnValueOnce(pending.promise);
  const { rpc, balance } = client();
  const read = rpc.fetchTotalBalance();
  await rpc.clearTimers();
  pending.resolve('{"spendable_balance":500000000000}');
  await read;
  expect(native.get_balance).not.toHaveBeenCalled();
  expect(balance).not.toHaveBeenCalled();
});

it("does not label the newly selected wallet with the old wallet's mining rewards", async () => {
  const pending = deferred<string>();
  (native.get_value_transfers as jest.Mock).mockReturnValueOnce(pending.promise);
  const { rpc, transfers } = client();
  const read = rpc.fetchTandZandOValueTransfers();
  await Promise.resolve();
  expect(native.get_value_transfers).toHaveBeenCalledTimes(1);
  await rpc.clearTimers();
  pending.resolve(
    JSON.stringify({
      value_transfers: [
        {
          kind: "received",
          is_coinbase: true,
          txid: "old-reward",
          status: "confirmed",
          blockheight: 99,
          value: 625000000,
        },
      ],
    }),
  );
  await read;
  expect(transfers).not.toHaveBeenCalled();
});

it("suppresses a stale initialization error after a wallet transition", async () => {
  const pending = deferred<string>();
  (native.poll_sync as jest.Mock).mockReturnValueOnce(pending.promise);
  const { rpc, error } = client();
  const poll = rpc.fetchSyncPoll();
  await rpc.clearTimers();
  pending.reject(new Error("Lightclient is not initialized"));
  await poll;
  expect(error).not.toHaveBeenCalled();
});

it("does not start another sync from a stale poll response", async () => {
  const pending = deferred<string>();
  (native.poll_sync as jest.Mock).mockReturnValueOnce(pending.promise);
  const { rpc } = client();
  const poll = rpc.fetchSyncPoll();
  await rpc.clearTimers();
  pending.resolve("Sync task has not been launched");
  await poll;
  expect(native.run_sync).not.toHaveBeenCalled();
});

it("invalidates pending results as soon as the wallet identity changes", async () => {
  const pending = deferred<string>();
  (native.get_balance as jest.Mock).mockReturnValueOnce(pending.promise);
  const { rpc, balance } = client();
  const read = rpc.fetchTotalBalance();
  await Promise.resolve();
  rpc.setCurrentWallet({ id: 7, fileName: "new.dat" } as WalletType);
  pending.resolve('{"total_ironwood_balance":500000000000}');
  await read;
  expect(balance).not.toHaveBeenCalled();
});

it("a stale configure cannot restart polling while another wallet is opening", async () => {
  const pending = deferred<unknown>();
  (ipcRenderer.invoke as jest.Mock).mockReturnValueOnce(pending.promise);
  const { rpc, transfers } = client();
  const configure = rpc.configure();
  await rpc.clearTimers();
  pending.resolve({});
  await configure;
  expect(transfers).not.toHaveBeenCalled();
  expect(rpc.updateTimerID).toBeUndefined();
  expect(rpc.priceTimerID).toBeUndefined();
});

it("reports genuine errors in the current session and accepts current balances", async () => {
  const { rpc, error, balance } = client();
  (native.poll_sync as jest.Mock).mockRejectedValueOnce(new Error("Lightclient is not initialized"));
  await rpc.fetchSyncPoll();
  expect(error).toHaveBeenCalledWith("Sync", "Lightclient is not initialized");
  await rpc.fetchTotalBalance();
  expect(balance).toHaveBeenCalledWith(expect.objectContaining({ totalIronwoodBalance: 1, totalSpendableBalance: 1 }));
});

it("keeps the new wallet's balance when an old read finishes after polling resumes", async () => {
  const pending = deferred<string>();
  (native.get_balance as jest.Mock).mockReturnValueOnce(pending.promise);
  const { rpc, balance } = client();
  const oldRead = rpc.fetchTotalBalance();
  await Promise.resolve();
  await rpc.clearTimers();
  jest.spyOn(rpc, "fetchTandZandOValueTransfers").mockResolvedValue();
  jest.spyOn(rpc, "fetchAddresses").mockResolvedValue();
  jest.spyOn(rpc, "fetchInfo").mockResolvedValue();
  jest.spyOn(rpc, "fetchTandZandOMessages").mockResolvedValue();
  const reconcile = jest.spyOn(RPC, "reconcileMigration").mockResolvedValue();
  (ipcRenderer.invoke as jest.Mock).mockResolvedValue({});
  try {
    await rpc.configure();
    pending.resolve('{"total_ironwood_balance":500000000000}');
    await oldRead;
    expect(balance).toHaveBeenCalledTimes(1);
    expect(balance).toHaveBeenCalledWith(expect.objectContaining({ totalIronwoodBalance: 1 }));
    expect(rpc.updateTimerID).toBeDefined();
  } finally {
    await rpc.clearTimers();
    reconcile.mockRestore();
  }
});
