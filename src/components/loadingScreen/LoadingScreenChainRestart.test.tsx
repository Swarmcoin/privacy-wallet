/**
 * A wallet made before the SWARM network restart of 2 October 2026 is moved
 * onto the restarted chain once, before it is opened, and its owner is told
 * why the balance starts again. See src/utils/chainRestart.ts and, for what
 * happens to the file itself, native/src/chain_restart.rs.
 */
import React from "react";
import { render, waitFor } from "../../test-utils";
import { native, ipcRenderer } from "../../electronBridge";
import { CreationTypeEnum, PerformanceLevelEnum, ServerChainNameEnum, ServerSelectionEnum, WalletType } from "../appstate";
import fetchServerList from "../../utils/fetchServerList";
import { CHAIN_RESTART_NOTICE, CHAIN_RESTART_NOTICE_TITLE } from "../../utils/chainRestart";
import { SWARM_MAINNET_GENESIS } from "../../utils/networkProfiles";

jest.mock("../../electronBridge");
jest.mock("../../utils/fetchServerList");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LoadingScreen } = require("./LoadingScreen");

const NEW_HINT = `swarm-mainnet:${SWARM_MAINNET_GENESIS}`;

const props = () => ({
  runRPCConfigure: jest.fn(),
  setInfo: jest.fn(),
  setReadOnly: jest.fn(),
  navigateToDashboard: jest.fn(),
  navigateToOnboarding: jest.fn(),
  setBirthday: jest.fn(),
  setPools: jest.fn(),
  setWallets: jest.fn(),
  setCurrentWallet: jest.fn(),
  setCurrentWalletOpenError: jest.fn(),
  setFetchError: jest.fn(),
});

/** A SWARM Mainnet wallet record as mainnet.9 wrote it: no genesis, port 8443. */
const oldRecord = (): WalletType => ({
  id: 4,
  fileName: "zingo-wallet-4.dat",
  alias: "1",
  chain_name: ServerChainNameEnum.swarmMainnetChainName,
  creationType: CreationTypeEnum.Seed,
  uri: "https://lwd-main.swarm.green:8443",
  selection: ServerSelectionEnum.custom,
  performanceLevel: PerformanceLevelEnum.High,
});

const order: string[] = [];

const boot = (wallet: WalletType) => {
  order.length = 0;
  (native.set_crypto_default_provider_to_ring as jest.Mock).mockResolvedValue(undefined);
  (native.wallet_exists as jest.Mock).mockResolvedValue(true);
  (native.get_latest_block_server as jest.Mock).mockReset().mockResolvedValue("140");
  (native.move_wallet_to_restarted_chain as jest.Mock).mockReset().mockImplementation(async () => {
    order.push("move");
    return JSON.stringify({ backup_path: "C:/x/zingo-wallet-4.dat.before-network-restart-1.bak", birthday: 1 });
  });
  (native.init_from_b64 as jest.Mock).mockReset().mockImplementation(async () => {
    order.push("open");
    return '{"birthday":1}';
  });
  (native.wallet_kind as jest.Mock).mockResolvedValue(
    '{"kind":"Loaded from seed phrase","orchard":true,"sapling":true,"transparent":true}',
  );
  (fetchServerList as jest.Mock).mockResolvedValue([]);
  (ipcRenderer.invoke as jest.Mock).mockReset().mockImplementation(async (channel: string) => {
    switch (channel) {
      case "wallets:all":
        return [wallet];
      case "loadSettings":
        return {
          serveruri: wallet.uri,
          serverchain_name: wallet.chain_name,
          serverselection: wallet.selection,
          currentwalletid: wallet.id,
        };
      default:
        return undefined;
    }
  });
  const openErrorModal = jest.fn();
  const p = props();
  render(<LoadingScreen {...p} />, { contextOverrides: { openErrorModal, closeErrorModal: jest.fn() } });
  return { openErrorModal, p };
};

const updates = () =>
  (ipcRenderer.invoke as jest.Mock).mock.calls.filter(([channel]) => channel === "wallets:update").map(([, w]) => w);

test("an old-chain mainnet wallet is moved before it is opened, and its owner is told", async () => {
  const { openErrorModal } = boot(oldRecord());

  await waitFor(() => expect(native.init_from_b64).toHaveBeenCalled());
  expect(order).toEqual(["move", "open"]);
  expect(native.move_wallet_to_restarted_chain).toHaveBeenCalledWith(
    NEW_HINT,
    PerformanceLevelEnum.High,
    3,
    "zingo-wallet-4.dat",
  );
  // The record now names the restarted chain and its indexer, so the move is
  // done once and never again.
  const last = updates()[updates().length - 1];
  expect(last.genesis).toBe(SWARM_MAINNET_GENESIS);
  expect(last.uri).toBe("https://lwd-main.swarm.green:443");
  // The wallet is opened against the restarted chain's indexer.
  expect((native.init_from_b64 as jest.Mock).mock.calls[0][0]).toBe("https://lwd-main.swarm.green:443");
  expect((native.init_from_b64 as jest.Mock).mock.calls[0][1]).toBe(NEW_HINT);

  await waitFor(() => expect(openErrorModal).toHaveBeenCalled());
  const [title, body] = openErrorModal.mock.calls[openErrorModal.mock.calls.length - 1];
  expect(title).toBe(CHAIN_RESTART_NOTICE_TITLE);
  const { container } = render(body);
  expect(container.textContent).toBe(
    "The SWARM network was restarted on 2 October 2026. Your addresses and recovery phrase are unchanged; balances start again from the new chain.",
  );
  expect(container.textContent).toBe(CHAIN_RESTART_NOTICE);
});

test("a wallet already on the restarted chain is opened untouched", async () => {
  const { openErrorModal } = boot({ ...oldRecord(), uri: "https://lwd-main.swarm.green:443", genesis: SWARM_MAINNET_GENESIS ?? undefined });

  await waitFor(() => expect(native.init_from_b64).toHaveBeenCalled());
  expect(native.move_wallet_to_restarted_chain).not.toHaveBeenCalled();
  expect(openErrorModal.mock.calls.map(([title]) => title)).not.toContain(CHAIN_RESTART_NOTICE_TITLE);
});

test("a record naming the abandoned genesis is moved too", async () => {
  boot({ ...oldRecord(), genesis: "01c34428b9e67cdd8345e0b365aaa37dd8d2d65d3869e0e5d77d567f2c39afdd" });
  await waitFor(() => expect(native.init_from_b64).toHaveBeenCalled());
  expect(order).toEqual(["move", "open"]);
});

test("a testnet wallet is never moved", async () => {
  boot({ ...oldRecord(), chain_name: ServerChainNameEnum.swarmTestnetChainName, uri: "https://lwd.swarm.green:443" });
  await waitFor(() => expect(native.init_from_b64).toHaveBeenCalled());
  expect(native.move_wallet_to_restarted_chain).not.toHaveBeenCalled();
});

test("if the move fails the wallet is not opened and the record is not marked", async () => {
  const { p } = boot(oldRecord());
  (native.move_wallet_to_restarted_chain as jest.Mock).mockRejectedValue(new Error("Error: initializing wallet: disk full"));

  await waitFor(() => expect(p.setCurrentWalletOpenError).toHaveBeenCalled());
  expect(native.init_from_b64).not.toHaveBeenCalled();
  expect(updates().some((w) => w.genesis === SWARM_MAINNET_GENESIS)).toBe(false);
});
