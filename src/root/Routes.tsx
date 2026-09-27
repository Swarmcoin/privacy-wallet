import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactModal from "react-modal";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { ErrorModal } from "../components/errorModal";
import cstyles from "../components/common/Common.module.css";
import routes from "../constants/routes.json";
import { Insight } from "../components/insight";
import { SendManyJsonType } from "../components/send";
import { LoadingScreen } from "../components/loadingScreen";
import {
  AppState,
  TotalBalanceClass,
  ValueTransferClass,
  SendPageStateClass,
  ToAddrClass,
  InfoClass,
  FetchErrorTypeClass,
  UnifiedAddressClass,
  TransparentAddressClass,
  SyncStatusType,
  ConfirmModalClass,
  ErrorModalClass,
  WalletType,
  ServerClass,
  ServerChainNameEnum,
  ServerSelectionEnum,
} from "../components/appstate";
import RPC from "../rpc/rpc";
import { ZcashURITarget } from "../utils/uris";
import pickRotationTarget from "../utils/pickRotationTarget";
import selectFastestServer from "../utils/selectFastestServer";
import { AddNewWallet } from "../components/addNewWallet";
import { AddressbookImpl } from "../components/addressBook";
import { Sidebar } from "../components/sideBar";
import { Swap } from "../components/swap";
import type { SwapDirectionEnum } from "../swap/enums/SwapDirectionEnum";
import { ContextAppProvider, defaultAppState } from "../context/ContextAppState";
import { SwapServiceProvider } from "../context/ContextSwapService";

import { native } from "../electronBridge";
import { userFacingError } from "../utils/userFacingError";
import { migrateExplorerChoice, usesMainnetExplorerSetting } from "../utils/explorerLinks";
import { OrchardMigration } from "../components/orchardMigration";
import { RPCIronwoodDrainType } from "../rpc/components/RPCIronwoodDrainType";
import { MixnetView, deriveMixnetView } from "../rpc/components/mixnetPresenter";
import { ServerHealthState } from "../rpc/components/serverHealth";
import { RPCMixnetStatusType } from "../rpc/components/RPCMixnetStatusType";
import { ConfirmModal } from "../components/confirmModal";
import ShieldResultContent from "./ShieldResultContent";
import LockScreen from "../components/lockScreen/LockScreen";
import AppSecurityModal from "../components/appSecurity/AppSecurityModal";
import ImportDataModal, { ImportScanResult } from "../components/importData/ImportDataModal";
import { SwarmShell } from "../components/swarm/SwarmShell";
import { SwarmUiProvider } from "../components/swarm/SwarmUiContext";
import { OverviewScreen } from "../components/swarm/screens/OverviewScreen";
import { SettingsScreen } from "../components/swarm/screens/SettingsScreen";
import { TreasuryScreen } from "../components/swarm/screens/TreasuryScreen";
import { SendScreen } from "../components/swarm/screens/SendScreen";
import { ReceiveScreen } from "../components/swarm/screens/ReceiveScreen";
import { ActivityScreen } from "../components/swarm/screens/ActivityScreen";
import { AddressesScreen } from "../components/swarm/screens/AddressesScreen";
import { OnboardingScreen } from "../components/swarm/screens/OnboardingScreen";
import { SwarmActionsContext } from "../components/swarm/SwarmActionsContext";

const { ipcRenderer } = window.electronAPI;

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const AppRoutes: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // --- state ---
  const [totalBalance, setTotalBalanceState] = useState(defaultAppState.totalBalance);
  const [addressesUnified, setAddressesUnifiedState] = useState(defaultAppState.addressesUnified);
  const [addressesTransparent, setAddressesTransparentState] = useState(defaultAppState.addressesTransparent);
  const [addressBook, setAddressBookState] = useState(defaultAppState.addressBook);
  const [valueTransfers, setValueTransfersState] = useState(defaultAppState.valueTransfers);
  const [messages, setMessagesState] = useState(defaultAppState.messages);
  const [sendPageState, setSendPageStateState] = useState(defaultAppState.sendPageState);
  const [info, setInfoState] = useState(defaultAppState.info);
  const [syncingStatus, setSyncingStatusState] = useState(defaultAppState.syncingStatus);
  const [verificationProgress, setVerificationProgressState] = useState(defaultAppState.verificationProgress);
  const [readOnly, setReadOnlyState] = useState(defaultAppState.readOnly);
  const [fetchError, setFetchErrorState] = useState(defaultAppState.fetchError);
  const [currentWallet, setCurrentWalletState] = useState(defaultAppState.currentWallet);
  const [currentWalletOpenError, setCurrentWalletOpenErrorState] = useState(defaultAppState.currentWalletOpenError);
  const [wallets, setWalletsState] = useState(defaultAppState.wallets);
  const [birthday, setBirthdayState] = useState(defaultAppState.birthday);
  const [orchardPool, setOrchardPoolState] = useState(defaultAppState.orchardPool);
  const [saplingPool, setSaplingPoolState] = useState(defaultAppState.saplingPool);
  const [transparentPool, setTransparentPoolState] = useState(defaultAppState.transparentPool);
  const [errorModal, setErrorModalState] = useState(defaultAppState.errorModal);
  const [confirmModal, setConfirmModalState] = useState(defaultAppState.confirmModal);
  const [locked, setLocked] = useState(false);
  const [lockChecked, setLockChecked] = useState(false);
  // What a lock asks for when it is applied. "code" is the code the user set;
  // "device" is the operating system prompt, which is what this screen locked
  // with before there was a code.
  const [lockMode, setLockMode] = useState<"none" | "code" | "device">("none");
  const [lockCodeSet, setLockCodeSet] = useState(false);
  const [deviceLockAvailable, setDeviceLockAvailable] = useState(false);
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importScanResult, setImportScanResult] = useState<ImportScanResult | null>(null);
  // Servers the user rotated away from this session. Kept here, not persisted:
  // rotating reopens the wallet but leaves this component mounted, so the memory
  // outlives the reopen and dies with the app.
  const [avoidedServers, setAvoidedServers] = useState<string[]>([]);

  // --- timers ---
  const fetchErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- setters (stable, with deepEqual guards) ---
  const setTotalBalance = useCallback((val: TotalBalanceClass) => {
    setTotalBalanceState((prev) => (deepEqual(prev, val) ? prev : val));
  }, []);

  const setAddressesUnified = useCallback((val: UnifiedAddressClass[]) => {
    setAddressesUnifiedState((prev) => (deepEqual(prev, val) ? prev : val));
  }, []);

  const setAddressesTransparent = useCallback((val: TransparentAddressClass[]) => {
    setAddressesTransparentState((prev) => (deepEqual(prev, val) ? prev : val));
  }, []);

  const setValueTransferList = useCallback((val: ValueTransferClass[]) => {
    setValueTransfersState((prev) => (deepEqual(prev, val) ? prev : val));
  }, []);

  const setMessagesList = useCallback((val: ValueTransferClass[]) => {
    setMessagesState((prev) => (deepEqual(prev, val) ? prev : val));
  }, []);

  const setInfo = useCallback((newInfo: InfoClass) => {
    setInfoState((prev) => {
      if (deepEqual(prev, newInfo)) return prev;
      return newInfo;
    });
  }, []);

  const setSyncStatus = useCallback((val: SyncStatusType) => {
    setSyncingStatusState((prev) => (deepEqual(prev, val) ? prev : val));
  }, []);

  const setVerificationProgress = useCallback((val: number | null) => {
    setVerificationProgressState(val);
  }, []);

  const setFetchError = useCallback((command: string, error: string) => {
    // Same failure as the one already showing: keep the state object, so a
    // failure republished every poll does not re-render the screen beneath it.
    // The timer still restarts, which is what holds the banner up.
    setFetchErrorState((prev) => (prev.command === command && prev.error === error ? prev : { command, error }));
    if (fetchErrorTimer.current) clearTimeout(fetchErrorTimer.current);
    // Longer than the 5s task cycle that republishes it. At exactly 5s a
    // persistent failure raced its own refresh and blinked.
    fetchErrorTimer.current = setTimeout(() => {
      fetchErrorTimer.current = null;
      setFetchErrorState({} as FetchErrorTypeClass);
    }, 12000);
  }, []);

  // ZEC price. Lives at the top level (NOT inside InfoClass) because the
  // periodic info-refresh rebuilds InfoClass and would otherwise clobber it
  // every 5s cycle. Fetched by RPC.getZecPrice over the mixnet only
  // (ADR 0024 arc 6): until Mixnet Mode wiring lands the fetch refuses,
  // the price stays 0, and the UI renders its `USD --` fallback.
  const [zecPrice, setZecPriceState] = useState<number>(0);
  const setZecPrice = useCallback((price?: number) => {
    if (typeof price === "number") setZecPriceState(price);
  }, []);

  const [mixnetView, setMixnetViewState] = useState<MixnetView>(defaultAppState.mixnetView);
  const [serverHealth, setServerHealthState] = useState<ServerHealthState>(defaultAppState.serverHealth);
  const setMixnetView = useCallback((view: MixnetView) => setMixnetViewState(view), []);
  const setServerHealth = useCallback((health: ServerHealthState) => setServerHealthState(health), []);

  // Main pushes the Mixnet Mode status on every transition (bootstrapping,
  // narration, ready, died, switched_off); project it to the view instantly so
  // the indicator never lags the transport.
  useEffect(() => {
    return ipcRenderer.on("mixnet-status", (_event: unknown, status: RPCMixnetStatusType) =>
      setMixnetView(deriveMixnetView(status)),
    );
  }, [setMixnetView]);

  // Pushed to the RPC instance as well as into context, the same way
  // `setCurrentWallet` does above: the info path is static and reads no
  // context, and it runs on the task loop where nothing else would tell it.
  const setReadOnly = useCallback((val: boolean) => {
    setReadOnlyState(val);
    rpcRef.current?.setReadOnly(val);
  }, []);
  const setWallets = useCallback((val: WalletType[]) => setWalletsState(val), []);
  const setBirthday = useCallback((val: number) => setBirthdayState(val), []);

  const clearWalletView = useCallback(() => {
    setTotalBalanceState(new TotalBalanceClass());
    setAddressesUnifiedState([]);
    setAddressesTransparentState([]);
    setValueTransfersState([]);
    setMessagesState([]);
    setInfoState(new InfoClass());
    setZecPriceState(0);
    setSyncingStatusState({} as SyncStatusType);
    setVerificationProgressState(null);
    if (fetchErrorTimer.current) clearTimeout(fetchErrorTimer.current);
    setFetchErrorState({} as FetchErrorTypeClass);
    setCurrentWalletOpenErrorState("");
    setSendPageStateState(new SendPageStateClass());
  }, []);

  const setCurrentWallet = useCallback(
    (val: WalletType | null) => {
      const previous = rpcRef.current?.currentWallet;
      rpcRef.current?.setCurrentWallet(val);
      if (
        previous?.id !== val?.id ||
        previous?.fileName !== val?.fileName ||
        previous?.chain_name !== val?.chain_name
      ) {
        clearWalletView();
      }
      setCurrentWalletState(val);
    },
    [clearWalletView],
  );

  const setCurrentWalletOpenError = useCallback((val: string) => setCurrentWalletOpenErrorState(val), []);

  const setPools = useCallback((orchard: boolean, sapling: boolean, transparent: boolean) => {
    setOrchardPoolState(orchard);
    setSaplingPoolState(sapling);
    setTransparentPoolState(transparent);
  }, []);

  const setSendPageState = useCallback((val: SendPageStateClass) => setSendPageStateState(val), []);

  // Block explorer config. Source of truth is electron-settings (`blockexplorer`
  // key); the React state mirrors it for context consumers. The setter writes
  // both atomically. Loaded at boot inside the existing `loadSettings` effect
  // below, so consumers (Sidebar, BlockExplorerModal) read it directly from
  // context with no prop drilling.
  const setBlockExplorer = useCallback(async (blockExplorer: any) => {
    setBlockExplorerState(blockExplorer);
    try {
      await ipcRenderer.invoke("saveSettings", { key: "blockexplorer", value: blockExplorer });
    } catch (e) {
      console.warn("setBlockExplorer: could not persist setting", e);
    }
  }, []);

  // Block explorer fields kept in a single object to avoid 8 useState
  const [blockExplorerConfig, setBlockExplorerState] = useState({
    blockExplorerMainnetAddress: defaultAppState.blockExplorerMainnetAddress,
    blockExplorerMainnetAddressCustom: defaultAppState.blockExplorerMainnetAddressCustom,
    blockExplorerMainnetTransaction: defaultAppState.blockExplorerMainnetTransaction,
    blockExplorerMainnetTransactionCustom: defaultAppState.blockExplorerMainnetTransactionCustom,
    blockExplorerTestnetAddress: defaultAppState.blockExplorerTestnetAddress,
    blockExplorerTestnetAddressCustom: defaultAppState.blockExplorerTestnetAddressCustom,
    blockExplorerTestnetTransaction: defaultAppState.blockExplorerTestnetTransaction,
    blockExplorerTestnetTransactionCustom: defaultAppState.blockExplorerTestnetTransactionCustom,
  });

  // --- RPC instance (stable ref, lazy init) ---
  const rpcRef = useRef<RPC | null>(null);
  if (!rpcRef.current) {
    ReactModal.setAppElement("#root");
    rpcRef.current = new RPC(
      setTotalBalance,
      setAddressesUnified,
      setAddressesTransparent,
      setValueTransferList,
      setMessagesList,
      setInfo,
      setZecPrice,
      setSyncStatus,
      setVerificationProgress,
      setFetchError,
      setMixnetView,
      setServerHealth,
      defaultAppState.currentWallet,
    );
  }

  // --- lifecycle ---
  useEffect(() => {
    (async () => {
      const book = await AddressbookImpl.readAddressBook();
      if (book && book.length > 0) setAddressBookState(book);

      // Contacts saved as a ZNS alias move to the address it resolves to, so
      // the screens that label transactions by address recognise them. Not
      // awaited: startup must not wait on a resolver over the network. The
      // result is applied to the book as it is by then, so a contact added in
      // the meantime is kept; a name that does not resolve is tried next start.
      AddressbookImpl.resolveStoredZnsAliases(book)
        .then((resolved) => {
          if (resolved.size === 0) return;
          setAddressBookState((prev) => {
            const { migrated, changed } = AddressbookImpl.migrateZnsAliases(prev, resolved);
            if (!changed) return prev;
            AddressbookImpl.writeAddressBook(migrated).catch((err) =>
              console.error("address book ZNS migration write failed", err),
            );
            return migrated;
          });
        })
        .catch((err) => console.log("address book ZNS migration failed", err));

      const [allSettings, authAvailability, lockStatus] = await Promise.all([
        ipcRenderer.invoke("loadSettings"),
        ipcRenderer.invoke("auth:check"),
        ipcRenderer.invoke("lock:status"),
      ]);
      // A code comes first. It is the lock the user set on purpose, and the one
      // they will look for; device authentication is the fallback when no code
      // is set, which is how this wallet locked before there was a code.
      const hasCode = !!lockStatus?.hasCode;
      const deviceLock = !!(allSettings?.requireDeviceAuth && authAvailability === "available");
      setLockCodeSet(hasCode);
      setDeviceLockAvailable(deviceLock);
      setLockMode(hasCode ? "code" : deviceLock ? "device" : "none");
      setLocked(hasCode || deviceLock);
      setLockChecked(true);
      if (allSettings && Object.prototype.hasOwnProperty.call(allSettings, "blockexplorer")) {
        // A stored choice from an older version may name a Zcash explorer (the
        // old default was Zcashexplorer) or one that was removed (Zypherscan).
        // Neither indexes a SWARM chain, so every value but Custom becomes the
        // SWARM explorer across the 4 explorer fields; see migrateExplorerChoice.
        const cfg = allSettings.blockexplorer;
        setBlockExplorerState({
          ...cfg,
          blockExplorerMainnetTransaction: migrateExplorerChoice(cfg?.blockExplorerMainnetTransaction),
          blockExplorerTestnetTransaction: migrateExplorerChoice(cfg?.blockExplorerTestnetTransaction),
          blockExplorerMainnetAddress: migrateExplorerChoice(cfg?.blockExplorerMainnetAddress),
          blockExplorerTestnetAddress: migrateExplorerChoice(cfg?.blockExplorerTestnetAddress),
        });
      }
    })();

    const appsecurityListener = () => setSecurityModalOpen(true);
    const subscriptions = [ipcRenderer.on("appsecurity", appsecurityListener)];

    // Change wallet folder location — main process handles the dialog, picker, and restart.
    const changeWalletDirListener = () => {
      ipcRenderer.invoke("wallet-dir:change");
    };
    subscriptions.push(ipcRenderer.on("change-wallet-dir", changeWalletDirListener));

    // Import data from another installation — kick off the folder picker, then open the modal.
    const importDataListener = async () => {
      const result = await ipcRenderer.invoke("import:scan");
      if (result?.ok) {
        setImportScanResult(result as ImportScanResult);
        setImportModalOpen(true);
      }
      // Cancellation / no-data / same-folder errors are surfaced by main-process dialogs
      // or simply do nothing here — keep the renderer flow quiet.
    };
    subscriptions.push(ipcRenderer.on("import-data", importDataListener));

    const appquittingListener = async () => {
      // Best-effort wallet save on shutdown. The wallet is already saved
      // continuously during the session, so this is a paranoia flush — we
      // don't block the close on it for more than ~800ms. Whichever finishes
      // first (the save or the cap) lets us send `appquitdone` and have the
      // main process exit instantly.
      const savePromise = native.save_wallet_file().catch(() => {});
      const cap = new Promise<void>((resolve) => setTimeout(resolve, 800));
      await Promise.race([savePromise, cap]);
      ipcRenderer.send("appquitdone");
    };
    subscriptions.push(ipcRenderer.on("appquitting", appquittingListener));

    return () => {
      if (fetchErrorTimer.current) clearTimeout(fetchErrorTimer.current);
      subscriptions.forEach((cancel) => cancel());
    };
  }, []);

  // --- modals ---
  const openErrorModal = useCallback((title: string, body: string | JSX.Element) => {
    const modal = new ErrorModalClass();
    modal.modalIsOpen = true;
    modal.title = title;
    modal.body = body;
    setErrorModalState(modal);
  }, []);

  const closeErrorModal = useCallback(() => {
    const modal = new ErrorModalClass();
    modal.modalIsOpen = false;
    setErrorModalState(modal);
  }, []);

  const openConfirmModal = useCallback(
    (
      title: string,
      body: string | JSX.Element,
      runAction: () => void,
      alternate?: { label: string; action: () => void },
    ) => {
      const modal = new ConfirmModalClass();
      modal.modalIsOpen = true;
      modal.title = title;
      modal.body = body;
      modal.runAction = runAction;
      modal.alternate = alternate;
      setConfirmModalState(modal);
    },
    [],
  );

  const closeConfirmModal = useCallback(() => {
    const modal = new ConfirmModalClass();
    modal.modalIsOpen = false;
    setConfirmModalState(modal);
  }, []);

  // --- locking and signing out ---
  /**
   * Ending the session for real: the wallet file is flushed, the wallet is
   * closed (so this process stops holding keys), and the application is
   * started again as a new process — the same state as a fresh double-click of
   * the launcher. Nothing is deleted: the wallet stays on this computer.
   */
  const signOutNow = useCallback(async () => {
    try {
      // The same best-effort flush the close path uses, capped so a slow disk
      // cannot leave someone looking at a window that will not go away.
      const save = native.save_wallet_file().catch(() => {});
      const cap = new Promise<void>((resolve) => setTimeout(resolve, 800));
      await Promise.race([save, cap]);
      await native.deinitialize().catch(() => {});
    } finally {
      await ipcRenderer.invoke("session:sign-out");
    }
  }, []);

  const signOut = useCallback(() => {
    openConfirmModal(
      "Sign out?",
      "SWARM Wallet will close and start again from the beginning. Your wallets and balances stay on this computer — signing out deletes nothing. Keep your recovery phrase: it is the only way into a wallet whose code has been forgotten.",
      () => {
        void signOutNow();
      },
    );
  }, [openConfirmModal, signOutNow]);

  /**
   * Locking needs something to come back in with. A code is the first choice;
   * device authentication is the fallback, and it only works where the platform
   * offers it and the user asked for it. With neither, locking would leave a
   * wallet nobody can open again, so this explains what to set rather than
   * doing that.
   */
  const lockNow = useCallback(() => {
    if (lockCodeSet) {
      setLockMode("code");
      setLocked(true);
      return;
    }
    if (deviceLockAvailable) {
      setLockMode("device");
      setLocked(true);
      return;
    }
    openConfirmModal(
      "Set a code first",
      "Locking this wallet needs something to unlock it with. Set a wallet code (Settings → Security → Wallet code), or turn on Unlock with Windows Hello under App Security. Until one of those is on, locking would leave the wallet with no way back in.",
      () => setSecurityModalOpen(true),
    );
  }, [deviceLockAvailable, lockCodeSet, openConfirmModal]);

  // The native menu's Lock Wallet and Sign Out items, wired to the same
  // handlers the buttons call, so a keyboard shortcut and a click can never do
  // two different things. Declared after the handlers on purpose: a listener
  // registered before them would close over nothing.
  useEffect(() => {
    const lockListener = () => lockNow();
    const signOutListener = () => signOut();
    const subscriptions = [ipcRenderer.on("lockwallet", lockListener), ipcRenderer.on("signout", signOutListener)];
    return () => subscriptions.forEach((cancel) => cancel());
  }, [lockNow, signOut]);

  // --- navigation ---
  const navigateToDashboard = useCallback(() => {
    navigate(routes.DASHBOARD, { replace: true, state: {} });
  }, [navigate]);

  // The first screen of a profile with no wallet. `replace` so Back cannot
  // land someone on the empty dashboard they were just spared.
  const navigateToOnboarding = useCallback(() => {
    navigate(routes.ADDNEWWALLET, { replace: true, state: { mode: "addnew" } });
  }, [navigate]);

  const navigateToLoadingScreen = useCallback(() => {
    navigate(routes.LOADING, { replace: true });
  }, [navigate]);

  const navigateToLoadingScreenChangingWallet = useCallback(async () => {
    // Invalidate outstanding replies before clearing what they used to display.
    await rpcRef.current?.clearTimers();
    clearWalletView();
    navigateToLoadingScreen();
  }, [navigateToLoadingScreen, clearWalletView]);

  // Changing the active server means reopening the wallet. `change_server` on a
  // live client swaps the URI but leaves it unable to reach the new one, so
  // every server picked that way looked dead — which is why that path sat unused
  // in the first place. Going round through LoadingScreen is what the wallet
  // settings screen already does, and it is the one that works.
  // `selection` is what the caller means by the move, and only the caller
  // knows. A hand pick from the list is the `list` mode by definition; a
  // rotation is auto doing exactly what auto is for and must stay on it.
  // Omitted, the mode is left alone — this function moves a server, and
  // deciding the mode on its behalf turned every rotation into a hand pick.
  const switchServer = useCallback(
    async (target: string, selection?: ServerSelectionEnum) => {
      const wallet: WalletType | null = currentWallet;
      if (!wallet?.uri || target === wallet.uri) {
        return;
      }
      // Probe before committing: reopening against a dead server would drop the
      // user on the wallet-open error screen instead of on their balances.
      const answered: ServerClass | null = await selectFastestServer([
        { uri: target, chain_name: wallet.chain_name, latency: null, default: false, obsolete: false },
      ]);
      if (!answered) {
        openErrorModal("Change Server", `${target} is not responding. Staying on the current server.`);
        return;
      }
      // A named selection is the user deciding, and it wipes what rotation
      // had been remembering. Those exclusions are auto's own bookkeeping —
      // "I already moved away from these" — and they mean nothing once the
      // user says which server they want, or says to start choosing again.
      // Left in place they would haunt the next rotation with rejections from
      // before the decision, and the wallet would run out of servers to move
      // to without ever having tried them under the new mode.
      //
      // A rotation names no selection and so clears nothing: it is the thing
      // doing the remembering.
      if (selection) {
        setAvoidedServers([]);
      }
      const moved: WalletType = { ...wallet, uri: target, ...(selection ? { selection } : {}) };
      await ipcRenderer.invoke("wallets:update", moved);
      await ipcRenderer.invoke("saveSettings", { key: "serveruri", value: target });
      if (selection) {
        await ipcRenderer.invoke("saveSettings", { key: "serverselection", value: selection });
      }
      setCurrentWallet(moved);
      setWallets(await ipcRenderer.invoke("wallets:all"));
      navigateToLoadingScreenChangingWallet();
    },
    [currentWallet, openErrorModal, setCurrentWallet, setWallets, navigateToLoadingScreenChangingWallet],
  );

  // Hand the choice of server back to the wallet.
  //
  // The mode changes and the server does not. Auto means "you may move me",
  // not "move me now": the one in use was reachable a moment ago, and throwing
  // away a working connection to prove the point would cost a reload for
  // nothing. Rotation is what moves it, on its own trigger, when this one
  // stops answering.
  //
  // So no reopen either, unlike `switchServer` — nothing the session is
  // talking to has changed.
  const delegateServerChoice = useCallback(async () => {
    const wallet: WalletType | null = currentWallet;
    if (!wallet || wallet.selection === ServerSelectionEnum.auto) {
      return;
    }
    // Same clean slate as a named switch: this is the same decision, taken
    // where the server happens to already be the one auto would pick.
    setAvoidedServers([]);
    const relaxed: WalletType = { ...wallet, selection: ServerSelectionEnum.auto };
    await ipcRenderer.invoke("wallets:update", relaxed);
    await ipcRenderer.invoke("saveSettings", { key: "serverselection", value: ServerSelectionEnum.auto });
    setCurrentWallet(relaxed);
    setWallets(await ipcRenderer.invoke("wallets:all"));
  }, [currentWallet, setCurrentWallet, setWallets]);

  const rotateServer = useCallback(async () => {
    const wallet: WalletType | null = currentWallet;
    if (!wallet?.uri) {
      return;
    }
    const rejected: string[] = [...avoidedServers, wallet.uri];
    const target: string | null = await pickRotationTarget(wallet.chain_name, rejected);
    if (!target) {
      openErrorModal("Change Server", "No other server is available for this network.");
      return;
    }
    // Remembered before the switch: reopening the wallet runs the boot-time
    // `auto` pick again, and without this it would take the registry head
    // straight back to the server just rejected.
    setAvoidedServers(rejected);
    await switchServer(target);
  }, [avoidedServers, currentWallet, openErrorModal, switchServer]);

  // --- address book ---
  const addAddressBookEntry = useCallback(
    (label: string, address: string, chain: ServerChainNameEnum, swapChain?: string) => {
      setAddressBookState((prev) => AddressbookImpl.addEntry(prev, label, address, chain, swapChain));
    },
    [],
  );

  const removeAddressBookEntry = useCallback((label: string) => {
    setAddressBookState((prev) => AddressbookImpl.removeEntry(prev, label));
  }, []);

  // --- context actions ---
  // Fills the Send screen from outside it: the Address Book, History, a payment
  // URI. A form nobody has started is replaced; one that already holds
  // recipients is added to, so a batch can be built by going back to the
  // Address Book between rows without losing the rows already written. Nothing
  // is dropped to respect the recipient cap: the screen asks for the extra ones
  // to be removed.
  const setSendTo = useCallback((target: ZcashURITarget | ZcashURITarget[]): void => {
    const incoming: ToAddrClass[] = (Array.isArray(target) ? target : [target]).map((t: ZcashURITarget) => {
      const to = new ToAddrClass();
      if (t.address) to.to = t.address;
      if (t.amount) to.amount = t.amount;
      if (t.memoString) to.memo = t.memoString;
      if (t.label) to.label = t.label;
      if (t.message) to.message = t.message;
      return to;
    });
    setSendPageStateState((previous: SendPageStateClass) => {
      const newState = new SendPageStateClass();
      const toaddrs: ToAddrClass[] = [...previous.toaddrs.filter(ToAddrClass.hasContent), ...incoming];
      newState.toaddrs = toaddrs.length > 0 ? toaddrs : [new ToAddrClass()];
      return newState;
    });
  }, []);

  // Handed to the Swap screen by the Address Book. Cleared by the screen once
  // read, so it prefills the field on arrival and never again.
  const [swapToState, setSwapToState] = useState<{
    address: string;
    swapChain: string;
    direction: SwapDirectionEnum;
  } | null>(null);
  const setSwapTo = useCallback(
    (t: { address: string; swapChain: string; direction: SwapDirectionEnum } | null): void => {
      setSwapToState(t);
    },
    [],
  );

  // A zero fee hides the Shield button (`ShieldBalance` requires one above
  // zero), so every failure here used to remove the button with no reason
  // given — transparent funds the wallet could not shield and a wallet that
  // simply refused to quote looked identical. The reason goes to the banner;
  // the number still says "no button".
  const calculateShieldFee = useCallback(async (): Promise<number> => {
    try {
      const result: string = await native.shield();
      if (!result) {
        setFetchError("Shield", "the wallet returned no shielding quote");
        return 0;
      }
      const resultJSON = JSON.parse(result);
      if (resultJSON.error) {
        setFetchError("Shield", userFacingError(resultJSON.error));
        return 0;
      }
      return resultJSON.fee ? resultJSON.fee / 10 ** 8 : 0;
    } catch (error) {
      console.error(`Critical Error calculate shield fee ${error}`);
      setFetchError("Shield", userFacingError(error));
      return 0;
    }
  }, [setFetchError]);

  const runRPCShieldTransparentBalanceToOrchard = useCallback(async (): Promise<string> => {
    return rpcRef.current!.shieldTransparentBalanceToIronwood();
  }, []);

  const handleShieldButtonConfirmed = useCallback(async () => {
    openErrorModal("Computing Transaction", "Please wait...This could take a while");
    setTimeout(async () => {
      try {
        // Throws on failure — the catch below surfaces it.
        const txidsResult: string = await runRPCShieldTransparentBalanceToOrchard();
        const txids: string[] = txidsResult.split(", ");
        const isMainnet = usesMainnetExplorerSetting(currentWallet?.chain_name);
        openErrorModal(
          "Successfully Broadcast Transaction",
          <ShieldResultContent
            txids={txids}
            chainName={currentWallet?.chain_name}
            blockExplorerTransaction={
              isMainnet
                ? blockExplorerConfig.blockExplorerMainnetTransaction
                : blockExplorerConfig.blockExplorerTestnetTransaction
            }
            blockExplorerTransactionCustom={
              isMainnet
                ? blockExplorerConfig.blockExplorerMainnetTransactionCustom
                : blockExplorerConfig.blockExplorerTestnetTransactionCustom
            }
          />,
        );
      } catch (err) {
        openErrorModal("Error Shielding Transaction", `${err}`);
      }
    }, 10);
  }, [currentWallet, blockExplorerConfig, openErrorModal, runRPCShieldTransparentBalanceToOrchard]);

  const handleShieldButton = useCallback(() => {
    openConfirmModal("Shield Transparent Funds", "Please confirm the Action", handleShieldButtonConfirmed);
  }, [openConfirmModal, handleShieldButtonConfirmed]);

  const runRPCRescan = useCallback(() => {
    openConfirmModal(
      "Rebuild wallet sync data",
      "This downloads the chain again and rebuilds the local transaction history. Your wallet keys, addresses and recovery phrase are kept. Balances will update as the scan completes.",
      async () => {
        await rpcRef.current?.refreshSync(true);
      },
    );
  }, [openConfirmModal]);

  // What the shell's Retry button runs: the ordinary sync, now, instead of at
  // the next tick of the poller. Not a rescan — a server that was briefly
  // unreachable does not need the chain read again from the birthday, and
  // offering that behind a button labelled "Retry" would be a trap.
  const runRPCRetrySync = useCallback(() => {
    rpcRef.current?.refreshSync(false);
  }, []);

  const runRPCSendTransaction = useCallback(async (sendJson: SendManyJsonType[]): Promise<string> => {
    try {
      const result: string = await rpcRef.current!.sendTransaction(sendJson);
      if (!result) throw result;
      return result;
    } catch (err) {
      console.error("route sendtx error", err);
      throw err;
    }
  }, []);

  const runRPCSendSwapDeposit = useCallback(
    async (args: {
      depositAddress: string;
      amountAtomic: number;
      memoBytes?: Uint8Array;
      viaSourceAddress?: boolean;
    }): Promise<string[]> => {
      return rpcRef.current!.sendSwapDeposit(args);
    },
    [],
  );

  const runRPCDrainToIronwood = useCallback(async (): Promise<{
    result: RPCIronwoodDrainType | null;
    error: string;
  }> => {
    return rpcRef.current!.drainOrchardToIronwood();
  }, []);

  // --- P4: memoized context value ---
  const contextAppState = useMemo<AppState>(
    () => ({
      totalBalance,
      addressesUnified,
      addressesTransparent,
      addressBook,
      valueTransfers,
      messages,
      sendPageState,
      info,
      syncingStatus,
      verificationProgress,
      readOnly,
      fetchError,
      currentWallet,
      currentWalletOpenError,
      wallets,
      birthday,
      orchardPool,
      saplingPool,
      transparentPool,
      swapToState,
      errorModal,
      confirmModal,
      openErrorModal,
      closeErrorModal,
      openConfirmModal,
      closeConfirmModal,
      setSendTo,
      setSwapTo,
      calculateShieldFee,
      handleShieldButton,
      addAddressBookEntry,
      zecPrice,
      mixnetView,
      serverHealth,
      rotateServer,
      switchServer,
      delegateServerChoice,
      reopenWallet: navigateToLoadingScreenChangingWallet,
      avoidedServers,
      blockExplorerMainnetAddress: blockExplorerConfig.blockExplorerMainnetAddress,
      blockExplorerMainnetAddressCustom: blockExplorerConfig.blockExplorerMainnetAddressCustom,
      blockExplorerMainnetTransaction: blockExplorerConfig.blockExplorerMainnetTransaction,
      blockExplorerMainnetTransactionCustom: blockExplorerConfig.blockExplorerMainnetTransactionCustom,
      blockExplorerTestnetAddress: blockExplorerConfig.blockExplorerTestnetAddress,
      blockExplorerTestnetAddressCustom: blockExplorerConfig.blockExplorerTestnetAddressCustom,
      blockExplorerTestnetTransaction: blockExplorerConfig.blockExplorerTestnetTransaction,
      blockExplorerTestnetTransactionCustom: blockExplorerConfig.blockExplorerTestnetTransactionCustom,
      setBlockExplorer,
    }),
    [
      totalBalance,
      addressesUnified,
      addressesTransparent,
      addressBook,
      valueTransfers,
      messages,
      sendPageState,
      info,
      syncingStatus,
      verificationProgress,
      readOnly,
      fetchError,
      currentWallet,
      currentWalletOpenError,
      wallets,
      birthday,
      orchardPool,
      saplingPool,
      transparentPool,
      swapToState,
      errorModal,
      confirmModal,
      openErrorModal,
      closeErrorModal,
      openConfirmModal,
      closeConfirmModal,
      setSendTo,
      setSwapTo,
      calculateShieldFee,
      handleShieldButton,
      addAddressBookEntry,
      zecPrice,
      mixnetView,
      serverHealth,
      rotateServer,
      switchServer,
      delegateServerChoice,
      navigateToLoadingScreenChangingWallet,
      avoidedServers,
      blockExplorerConfig,
      setBlockExplorer,
    ],
  );

  // The same handlers the native menu fires, offered to Settings as well.
  const swarmActions = useMemo(
    () => ({
      openSecurity: () => setSecurityModalOpen(true),
      openImport: async () => {
        const result = await ipcRenderer.invoke("import:scan");
        if (result?.ok) {
          setImportScanResult(result as ImportScanResult);
          setImportModalOpen(true);
        }
      },
      rescan: runRPCRescan,
      retrySync: runRPCRetrySync,
      lockNow,
      signOut,
    }),
    [runRPCRescan, runRPCRetrySync, lockNow, signOut],
  );

  if (!lockChecked) return null;

  if (locked) {
    return (
      <ContextAppProvider value={contextAppState}>
        <LockScreen
          mode={lockMode === "code" ? "code" : "device"}
          onUnlock={() => setLocked(false)}
          onSignOut={signOut}
        />
      </ContextAppProvider>
    );
  }

  return (
    <ContextAppProvider value={contextAppState}>
      <AppSecurityModal isOpen={securityModalOpen} onClose={() => setSecurityModalOpen(false)} />
      <ImportDataModal
        isOpen={importModalOpen}
        scanResult={importScanResult}
        onClose={() => {
          setImportModalOpen(false);
          setImportScanResult(null);
        }}
      />

      {confirmModal.modalIsOpen && <ConfirmModal closeModal={closeConfirmModal} />}
      {errorModal.modalIsOpen && <ErrorModal closeModal={closeErrorModal} />}

      {/* The swap store binds against the loaded wallet's UFVK, which needs the
          lightclient up. `currentWallet` is set while the loading screen is
          still opening the wallet, so it is not that signal: leaving the
          loading route is. Keyed by the wallet so a switch rebinds the store
          and re-arms the poller against the new one. */}
      <SwapServiceProvider
        key={currentWallet?.id ?? "no-wallet"}
        chainName={currentWallet?.chain_name ?? ServerChainNameEnum.mainChainName}
        enabled={!!currentWallet && !currentWalletOpenError && location.pathname !== routes.LOADING}
      >
        <SwarmActionsContext.Provider value={swarmActions}>
          <SwarmUiProvider>
            {/*
            The old sidebar, kept mounted and out of sight.

            Nothing in it is drawn any more — the rail replaced it — but it is
            where the native menu's handlers are registered (rescan, pay URI,
            export, the wallet menu items), and where three modals live. Its
            modals portal to the document body, so hiding the element hides the
            sidebar and not them. Unmounting it would silently break every menu
            item in the application; moving the handlers out is a change to
            logic this one is not making.
          */}
            <div style={{ display: "none" }} aria-hidden="true">
              <Sidebar doRescan={runRPCRescan} />
            </div>

            {location.pathname === routes.LOADING || location.pathname === routes.ADDNEWWALLET ? (
              // Opening a wallet and adding one are the two screens that exist
              // before there is a wallet to frame. They take the whole window.
              <div className={cstyles.contentcontainer} style={{ left: 0, width: "100vw" }}>
                <Routes>
                  <Route
                    path={routes.ADDNEWWALLET}
                    element={
                      <OnboardingScreen>
                        <AddNewWallet
                          closeModal={navigateToDashboard}
                          setWallets={setWallets}
                          setCurrentWallet={setCurrentWallet}
                          navigateToLoadingScreenChangingWallet={navigateToLoadingScreenChangingWallet}
                          doSaveWallet={() => RPC.doSave()}
                          clearTimers={() => rpcRef.current?.clearTimers() ?? Promise.resolve()}
                        />
                      </OnboardingScreen>
                    }
                  />
                  <Route
                    path={routes.LOADING}
                    element={
                      <LoadingScreen
                        runRPCConfigure={() => rpcRef.current?.configure()}
                        setInfo={setInfo}
                        setReadOnly={setReadOnly}
                        navigateToDashboard={navigateToDashboard}
                        navigateToOnboarding={navigateToOnboarding}
                        setBirthday={setBirthday}
                        setPools={setPools}
                        setWallets={setWallets}
                        setCurrentWallet={setCurrentWallet}
                        setCurrentWalletOpenError={setCurrentWalletOpenError}
                        setFetchError={setFetchError}
                      />
                    }
                  />
                </Routes>
              </div>
            ) : (
              <SwarmShell onRetry={runRPCRetrySync} onRebuild={runRPCRescan}>
                <Routes>
                  <Route path={routes.DASHBOARD} element={<OverviewScreen />} />
                  <Route path={routes.SETTINGS} element={<SettingsScreen />} />
                  {/*
                    Registered on every build, shown in the rail only where
                    `treasuryIsVisible` says so. A route that exists but is
                    not offered costs nothing; a rail entry that leads
                    nowhere costs a bug report.
                  */}
                  <Route path={routes.TREASURY} element={<TreasuryScreen />} />
                  <Route
                    path={routes.SEND}
                    element={<SendScreen sendTransaction={runRPCSendTransaction} setSendPageState={setSendPageState} />}
                  />
                  <Route path={routes.RECEIVE} element={<ReceiveScreen />} />
                  <Route
                    path={routes.ADDRESSBOOK}
                    element={
                      <AddressesScreen
                        addAddressBookEntry={addAddressBookEntry}
                        removeAddressBookEntry={removeAddressBookEntry}
                      />
                    }
                  />
                  <Route path={routes.INSIGHT} element={<Insight />} />
                  <Route path={routes.HISTORY} element={<ActivityScreen />} />
                  <Route
                    path={routes.SWAP}
                    element={<Swap sendSwapDeposit={runRPCSendSwapDeposit} addAddressBookEntry={addAddressBookEntry} />}
                  />
                  {/* Memos are a filter inside Activity now, not a screen of their own:
                    a memo is a property of a payment. The route stays so a menu item
                    or a saved link still lands somewhere sensible. */}
                  <Route path={routes.MESSAGES} element={<ActivityScreen />} />
                  <Route
                    path={routes.MIGRATION}
                    element={<OrchardMigration drainToIronwood={runRPCDrainToIronwood} />}
                  />
                </Routes>
              </SwarmShell>
            )}
          </SwarmUiProvider>
        </SwarmActionsContext.Provider>
      </SwapServiceProvider>
    </ContextAppProvider>
  );
};

export default AppRoutes;
