import React, { ReactNode, useContext } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import styles from "./Swarm.module.css";
import { SwarmIcon, SwarmIconName } from "./SwarmIcons";
import { SwarmProblemBar } from "./SwarmProblem";
import { SwarmWalletMenu } from "./SwarmWalletMenu";
import SwarmUiContext from "./SwarmUiContext";
import { SwarmActionsContext } from "./SwarmActionsContext";
import { currentProblem, deriveStatus } from "./swarmStatus";
import SwarmMark from "../logo/SwarmMark";
import { ContextApp } from "../../context/ContextAppState";
import routes from "../../constants/routes.json";
import APP_VERSION from "../../version";
import { SWARM_COINS_ARE_TEST_COINS, SWARM_NETWORK_LABEL, SWARM_DEFAULT_SERVER } from "../../utils/swarmNetwork";
import { TREASURY_ON_BY_DEFAULT } from "../../treasury/treasuryVisibility";

/**
 * The application frame: the hive rail on the left, everything else on the
 * right.
 *
 * The screens it wraps are the mockup's six — Overview, Send, Receive,
 * Activity, Addresses, Settings — which is the old app's seven with Messages
 * folded into Activity as a filter (memos are a property of a transfer, not a
 * separate inbox) and the Address Book joined to the wallet's own addresses
 * under one heading.
 */

export type SwarmScreenId =
  | "overview"
  | "send"
  | "receive"
  | "activity"
  | "price"
  | "addresses"
  | "treasury"
  | "settings";

type NavEntry = {
  id: SwarmScreenId;
  label: string;
  icon: SwarmIconName;
  route: string;
  kicker: string;
  title: string;
};

export const SWARM_NAV: NavEntry[] = [
  {
    id: "overview",
    label: "Overview",
    icon: "overview",
    route: routes.DASHBOARD,
    kicker: "ACCOUNT",
    title: "Overview",
  },
  { id: "send", label: "Send", icon: "send", route: routes.SEND, kicker: "TRANSFER", title: "Send SWM" },
  { id: "receive", label: "Receive", icon: "receive", route: routes.RECEIVE, kicker: "INCOMING", title: "Receive SWM" },
  { id: "activity", label: "Activity", icon: "activity", route: routes.HISTORY, kicker: "HISTORY", title: "Activity" },
  // The SWM price page (specs/PRICE-DISPLAY.md §6). Mainnet builds only.
  { id: "price", label: "Price", icon: "chart", route: routes.PRICE, kicker: "MARKET", title: "SWM price" },
  {
    id: "addresses",
    label: "Addresses",
    icon: "addresses",
    route: routes.ADDRESSBOOK,
    kicker: "ADDRESSES & CONTACTS",
    title: "Addresses",
  },
  {
    id: "treasury",
    label: "Treasury",
    icon: "shield",
    route: routes.TREASURY,
    kicker: "2-OF-3 CUSTODY",
    title: "Treasury",
  },
  {
    id: "settings",
    label: "Settings",
    icon: "settings",
    route: routes.SETTINGS,
    kicker: "PREFERENCES",
    title: "Settings",
  },
];

/**
 * The rail's entries for this build.
 *
 * Treasury is mainnet-only. The funds it spends from are mainnet P2SH
 * addresses and the policies the build ships are mainnet policies; a testnet
 * build that showed the page would show four funds it can say nothing true
 * about. A testnet build that has been given a testnet policy shows it, which
 * is what `treasuryIsVisible` decides.
 */
export function visibleNav(treasuryVisible: boolean, priceVisible = !SWARM_COINS_ARE_TEST_COINS): NavEntry[] {
  // Price is mainnet-only too: test coins have no price, and a test-coin
  // build never asks for one.
  return SWARM_NAV.filter(
    (entry) => (entry.id !== "treasury" || treasuryVisible) && (entry.id !== "price" || priceVisible),
  );
}

export function navForPath(pathname: string): NavEntry {
  const match = SWARM_NAV.find((n) => pathname.toLowerCase().startsWith(n.route.toLowerCase()));
  return match ?? SWARM_NAV[0];
}

type SwarmShellProps = {
  children: ReactNode;
  /** Re-runs the sync the app would have run anyway, now. */
  onRetry: () => void;
  /** Clears the local sync data and re-syncs from the server (a rebuild). */
  onRebuild?: () => void;
};

const STATUS_CLASS = {
  synced: styles.statusSynced,
  syncing: styles.statusSyncing,
  // Neutral, not red: nothing has gone wrong yet.
  connecting: styles.statusConnecting,
  disconnected: styles.statusDisconnected,
} as const;

export const SwarmShell: React.FC<SwarmShellProps> = ({ children, onRetry, onRebuild }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { hidden, toggleHidden } = useContext(SwarmUiContext);
  const { lockNow, signOut } = useContext(SwarmActionsContext);
  const { info, verificationProgress, syncingStatus, fetchError, readOnly, currentWallet, reopenWallet } =
    useContext(ContextApp);

  // The server this profile is set to, which exists from first run whether or
  // not a wallet does. Without it the header claimed "No server configured"
  // on every fresh install until the user created a wallet (defect W-5).
  const configuredServer = currentWallet?.uri || SWARM_DEFAULT_SERVER;
  const status = deriveStatus(info, verificationProgress, syncingStatus, configuredServer);
  const problem = currentProblem(fetchError, syncingStatus, status.host);
  const active = navForPath(location.pathname);
  const walletReady = !!currentWallet?.id;

  return (
    <div className={styles.shell}>
      <nav className={styles.rail} aria-label="Wallet sections">
        <div className={styles.brand}>
          <SwarmMark size={28} />
          <div className={styles.brandName}>SWARM</div>
        </div>

        <SwarmWalletMenu reopenWallet={reopenWallet} />

        {visibleNav(TREASURY_ON_BY_DEFAULT).map((entry) => {
          // Send needs a wallet that can spend. The others are readable on a
          // watch-only wallet, and hiding them would leave a rail with one item.
          const disabled = entry.id === "send" && (!walletReady || readOnly);
          const isActive = entry.id === active.id;
          return (
            <button
              key={entry.id}
              type="button"
              className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
              aria-current={isActive ? "page" : undefined}
              disabled={disabled}
              style={disabled ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
              onClick={() => navigate(entry.route)}
            >
              <SwarmIcon name={entry.icon} />
              {entry.label}
            </button>
          );
        })}

        <div className={styles.railFoot}>
          <div className={`${styles.statusChip} ${STATUS_CLASS[status.state]}`}>
            <div className={styles.statusHead}>
              <span className={styles.statusDot} />
              {status.label.toUpperCase()}
            </div>
            <div className={styles.statusDetail}>{status.detail}</div>
          </div>
          {/*
            Lock and sign out live here, above the version line, so they are in
            the same place on every screen. Sign out in particular was asked for
            by name: it ends the session completely and starts the application
            again, which is what the Sign out button in any other application
            does.
          */}
          <div className={styles.railActions}>
            <button
              type="button"
              className={styles.railAction}
              onClick={lockNow}
              title="Lock the wallet — your code, or your device authentication, is asked for again"
            >
              Lock
            </button>
            <button
              type="button"
              className={styles.railSignOut}
              onClick={signOut}
              title="Sign out — closes SWARM Wallet and starts it again"
            >
              Sign out
            </button>
          </div>
          <div className={styles.versionLine}>
            SWARM Wallet {APP_VERSION}
            <br />
            {SWARM_NETWORK_LABEL}
          </div>
        </div>
      </nav>

      <main className={styles.main}>
        <div className={styles.topBar}>
          <div>
            <div className={styles.kicker}>{active.kicker}</div>
            <h1 className={styles.screenTitle}>{active.title}</h1>
          </div>
          <div className={styles.topActions}>
            <button type="button" className={styles.pillButton} onClick={toggleHidden} aria-pressed={hidden}>
              <SwarmIcon name={hidden ? "eye" : "eyeOff"} size={15} />
              {hidden ? "Show balances" : "Hide balances"}
            </button>
            {/*
              The mockup's privacy switch is a toggle. It is an indicator here:
              this network has no way to send a public payment from a shielded
              balance on purpose, so a switch that claimed to turn privacy off
              would be a control over something the wallet does not do. What is
              true — that every payment out of the shielded pool is shielded —
              is what it says.
            */}
            <div className={styles.privacyPill} title="Every payment from your shielded balance is private.">
              <div style={{ textAlign: "right" }}>
                <div className={styles.privacyTag}>SHIELDED BY DEFAULT</div>
                <div className={styles.privacySub}>Sender, recipient and amount are hidden</div>
              </div>
              <span style={{ color: "var(--swarm-orange)", display: "flex" }}>
                <SwarmIcon name="shield" size={18} />
              </span>
            </div>
          </div>
        </div>

        <SwarmProblemBar problem={problem} onRetry={onRetry} onRebuild={onRebuild} />

        {children}
      </main>
    </div>
  );
};

export default SwarmShell;
