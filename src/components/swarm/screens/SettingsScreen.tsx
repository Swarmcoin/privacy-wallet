import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "../Swarm.module.css";
import { SwarmIcon, SwarmIconName } from "../SwarmIcons";
import SwarmActionsContext from "../SwarmActionsContext";
import { deriveStatus, serverHost } from "../swarmStatus";
import { ContextApp } from "../../../context/ContextAppState";
import MixnetModal from "../../sideBar/components/MixnetModal";
import AppSecurityModal from "../../appSecurity/AppSecurityModal";
import LockCodeModal from "../../lockScreen/LockCodeModal";
import { ipcRenderer } from "../../../electronBridge";
import routes from "../../../constants/routes.json";
import APP_VERSION, { UPSTREAM_VERSION } from "../../../version";
import { SWARM_COINS_ARE_TEST_COINS, SWARM_NETWORK_LABEL, SWARM_TICKER } from "../../../utils/swarmNetwork";
import { ADD_NEW, RESTORE, chooseWallet } from "../../walletBar/walletSwitching";

/**
 * Settings: what is true of this wallet, and the handful of things you can
 * change about it.
 *
 * Most of these used to be reachable only from the native menu — device
 * authentication, importing another installation's data, rescanning — which is
 * where a user looks last and a new user never looks. They are offered here as
 * well, calling the same handlers.
 *
 * Read-only rows stay read-only on purpose. The chain a wallet is on is fixed
 * when the wallet is created, and a control that appeared to change it would
 * be offering to move someone's money to a network it does not exist on.
 */

type Row =
  | { kind: "value"; k: string; d: string; v: string; tone?: "good" | "warn" }
  | { kind: "action"; k: string; d: string; action: string; onClick: () => void; disabled?: boolean }
  | { kind: "toggle"; k: string; d: string; on: boolean; onChange: (on: boolean) => void };

/** Settings → Price: the help text is specs/PRICE-DISPLAY.md §2.2, word for word. */
export const SWM_PRICE_SETTING_LABEL = "Show SWM price (USD)";
export const SWM_PRICE_SETTING_HELP =
  "The price comes from the SWARM price service (wallet.swarm.green), which reads the SWM/ETH pool on Base from GeckoTerminal and DexScreener. Your addresses and balances are never sent. Switch this off and the wallet makes no price requests.";

type Group = { title: string; icon: SwarmIconName; rows: Row[] };

export const SettingsScreen: React.FC = () => {
  const navigate = useNavigate();
  const { openImport, rescan, lockNow, signOut } = useContext(SwarmActionsContext);
  const {
    info,
    currentWallet,
    readOnly,
    birthday,
    verificationProgress,
    syncingStatus,
    wallets,
    openErrorModal,
    reopenWallet,
    showSwmPrice,
    setShowSwmPrice,
  } = useContext(ContextApp);

  const [mixnetOpen, setMixnetOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [lockCodeOpen, setLockCodeOpen] = useState(false);
  // Whether a code is set is asked for here rather than passed in: the answer
  // belongs to the main process, and this screen must not guess it — the row
  // below says "Set…" or "Change…" depending on it.
  const [hasLockCode, setHasLockCode] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const status: { hasCode?: boolean } = await ipcRenderer.invoke("lock:status");
      if (live) setHasLockCode(!!status?.hasCode);
    })();
    return () => {
      live = false;
    };
  }, []);

  const status = deriveStatus(info, verificationProgress, syncingStatus);

  const go = (value: string) =>
    chooseWallet(value, {
      currentWalletId: currentWallet?.id,
      navigate,
      openErrorModal,
      reopenWallet,
    });

  const groups: Group[] = [
    {
      title: "Network",
      icon: "globe",
      rows: [
        {
          kind: "value",
          k: "Network",
          d: "The chain this wallet lives on — fixed when it was created",
          v: SWARM_NETWORK_LABEL,
        },
        {
          kind: "value",
          k: "Server",
          d: "The indexer this wallet talks to",
          v: serverHost(info.serverUri) || "not set",
        },
        {
          kind: "value",
          k: "Connection",
          d: "What the server last told us",
          v: status.state === "synced" ? `Synced · #${info.latestBlock}` : status.label,
          tone: status.state === "synced" ? "good" : "warn",
        },
        { kind: "value", k: "Coin", d: "What balances are counted in", v: SWARM_TICKER },
        {
          kind: "action",
          k: "Nym mixnet",
          d: "Hide your IP from the indexer. Not available on this network",
          action: "Open…",
          onClick: () => setMixnetOpen(true),
        },
      ],
    },
    // Mainnet builds only: test coins have no price, and a test-coin build
    // never asks for one, so a switch for it would switch nothing.
    ...(SWARM_COINS_ARE_TEST_COINS
      ? []
      : [
          {
            title: "Price",
            icon: "chart" as SwarmIconName,
            rows: [
              {
                kind: "toggle" as const,
                k: SWM_PRICE_SETTING_LABEL,
                d: SWM_PRICE_SETTING_HELP,
                on: showSwmPrice,
                onChange: setShowSwmPrice,
              },
              {
                kind: "value" as const,
                k: "Price service",
                d: "One request a minute while the wallet is open and on screen. No address, no balance, no identifier",
                v: showSwmPrice ? "wallet.swarm.green" : "off",
              },
            ],
          },
        ]),
    {
      title: "This wallet",
      icon: "key",
      rows: [
        { kind: "value", k: "Name", d: "A local label only — never sent anywhere", v: currentWallet?.alias ?? "—" },
        { kind: "value", k: "Created", d: "How this wallet was made", v: currentWallet?.creationType ?? "—" },
        { kind: "value", k: "Birthday", d: "The height it starts scanning from", v: birthday ? `#${birthday}` : "—" },
        {
          kind: "value",
          k: "Mode",
          d: "Whether it holds a spending key",
          v: readOnly ? "Watch-only" : "Can send",
          tone: readOnly ? "warn" : "good",
        },
        {
          kind: "action",
          k: "Rescan",
          d: "Read the chain again from the birthday. Slow, and never necessary twice",
          action: "Rescan…",
          onClick: rescan,
        },
      ],
    },
    {
      title: "Security",
      icon: "lock",
      rows: [
        {
          kind: "action",
          k: "Unlock with Windows Hello",
          d: "Ask for the device's own authentication before opening the wallet",
          action: "Settings…",
          // This modal is self-contained — it reads and writes its own setting
          // over IPC — so it is mounted here rather than routed through the
          // one the native menu opens.
          onClick: () => setSecurityOpen(true),
        },
        {
          kind: "action",
          k: "Wallet code",
          d: hasLockCode
            ? "A code is set. It is asked for every time this wallet is locked"
            : "Set a code you type to open this wallet after locking it",
          action: hasLockCode ? "Change…" : "Set…",
          onClick: () => setLockCodeOpen(true),
        },
        {
          kind: "action",
          k: "Lock now",
          d: "Lock the wallet without closing it — your code, or your device authentication, is asked for again",
          action: "Lock",
          onClick: lockNow,
        },
        {
          kind: "action",
          k: "Sign out",
          d: "Close this wallet and start SWARM Wallet again from the beginning. Your wallets stay on this computer",
          action: "Sign out",
          onClick: signOut,
        },
        {
          kind: "value",
          k: "Recovery phrase",
          d: "In the menu under Wallet → Seed Phrase. Never shown unprompted, never logged",
          v: "Wallet menu",
        },
      ],
    },
    {
      title: "Wallets & data",
      icon: "addresses",
      rows: [
        {
          kind: "value",
          k: "Wallets on this computer",
          d: "Switch between them from the rail",
          v: String(wallets?.length ?? 0),
        },
        {
          kind: "action",
          k: "Add a new wallet",
          d: "Create a fresh one, with a new recovery phrase",
          action: "Add…",
          onClick: () => void go(ADD_NEW),
        },
        {
          kind: "action",
          k: "Restore a wallet",
          d: "From a recovery phrase, a viewing key or a wallet file",
          action: "Restore…",
          onClick: () => void go(RESTORE),
        },
        {
          kind: "action",
          k: "Import from another installation",
          d: "Copy wallets and settings out of a previous install",
          action: "Import…",
          onClick: openImport,
        },
      ],
    },
  ];

  return (
    <>
      <div className={styles.settingsGrid}>
        {groups.map((group) => (
          <section key={group.title} className={styles.panel}>
            <div className={styles.panelHead}>
              <span style={{ color: "var(--swarm-orange)", display: "flex" }}>
                <SwarmIcon name={group.icon} />
              </span>
              <div className={styles.panelTitle} style={{ flex: 1 }}>
                {group.title}
              </div>
            </div>
            <div className={styles.panelBody}>
              {group.rows.map((r) => (
                <div key={r.k} className={styles.rowItem} style={{ cursor: "default" }}>
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>{r.k}</span>
                    <span className={styles.statNote}>{r.d}</span>
                  </span>
                  {r.kind === "toggle" ? (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={r.on}
                      aria-label={r.k}
                      className={`${styles.toggle} ${r.on ? styles.toggleOn : ""}`}
                      onClick={() => r.onChange(!r.on)}
                    />
                  ) : r.kind === "value" ? (
                    <span
                      className={`${styles.mono} ${styles.settingValue}`}
                      style={
                        r.tone === "good"
                          ? { color: "var(--swarm-green)" }
                          : r.tone === "warn"
                            ? { color: "var(--swarm-honey)" }
                            : undefined
                      }
                    >
                      {r.v}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnSmall}`}
                      onClick={r.onClick}
                      disabled={r.disabled}
                    >
                      {r.action}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}

        <section className={`${styles.panel} ${styles.panelPad}`} aria-label="About">
          <div className={styles.panelTitle}>About</div>
          <div className={styles.factList}>
            <div className={styles.factRow}>
              <span>SWARM Wallet</span>
              <span className={styles.factVisible}>{APP_VERSION}</span>
            </div>
            <div className={styles.factRow}>
              <span>Network</span>
              <span className={styles.factVisible}>{SWARM_NETWORK_LABEL}</span>
            </div>
          </div>
          {/*
            The attribution the licence requires. Word for word the sentence
            the About box already uses, and word for word what
            scripts/check-swarm-bundle-strings.js allows by name — not because
            the check is in the way, but because two different wordings of the
            same attribution is how one of them quietly drifts into being
            wrong. The MIT licence requires the copyright notice to travel
            with the code, and saying what this is built on is the honest
            thing to do besides.
          */}
          <div className={styles.licence}>
            Based on Zingo PC {UPSTREAM_VERSION} by ZingoLabs, under the MIT licence below.
            <br />
            The MIT License (MIT) Copyright (c) 2026 ZingoLabs
            <br />
            The full notice is in the application menu, under About.
          </div>
          <button type="button" className={styles.panelLink} onClick={() => navigate(routes.DASHBOARD)}>
            Back to Overview →
          </button>
        </section>
      </div>

      <MixnetModal modalIsOpen={mixnetOpen} closeModal={() => setMixnetOpen(false)} />
      <AppSecurityModal isOpen={securityOpen} onClose={() => setSecurityOpen(false)} />
      <LockCodeModal
        isOpen={lockCodeOpen}
        onClose={() => setLockCodeOpen(false)}
        onCodeChanged={(has) => setHasLockCode(has)}
      />
    </>
  );
};

export default SettingsScreen;
