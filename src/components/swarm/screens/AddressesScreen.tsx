import React, { useContext, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "../Swarm.module.css";
import { SwarmIcon } from "../SwarmIcons";
import { abbreviate, deriveOwnAddresses } from "../swarmModel";
import { ContextApp } from "../../../context/ContextAppState";
import { AddressBookEntryClass, ServerChainNameEnum } from "../../appstate";
import { useCopy } from "../../common/useCopy";
import { ZcashURITarget } from "../../../utils/uris";
import Utils from "../../../utils/utils";
import routes from "../../../constants/routes.json";
import { addressPlaceholderFor, swarmProfileOrActive } from "../../../utils/swarmNetwork";

/**
 * Addresses: the ones this wallet owns, and the ones it knows by name.
 *
 * The old application split these across two screens — Receive for your own,
 * Address Book for everyone else's — which made "what addresses are involved
 * in my wallet" a question you had to ask twice. The mockup puts them on one
 * screen and so does this.
 *
 * Adding a contact goes through the application's own `addAddressBookEntry`,
 * and the address is checked by the same `Utils.getAddressKind` the Send
 * screen uses, so a contact that could never be paid cannot be filed.
 */

type AddressesScreenProps = {
  addAddressBookEntry: (label: string, address: string, chain: ServerChainNameEnum, swapChain?: string) => void;
  removeAddressBookEntry: (label: string, address: string) => void;
};

const OwnAddressCard: React.FC<{ address: string; label: string; note: string; transparent: boolean }> = ({
  address,
  label,
  note,
  transparent,
}) => {
  const { copied, copy } = useCopy(1500);
  return (
    <div className={`${styles.statCard} ${transparent ? styles.statCardTransparent : styles.statCardShielded}`}>
      <div
        className={styles.statKicker}
        style={{ color: transparent ? "var(--swarm-clear-blue)" : "var(--swarm-orange)" }}
      >
        <span className={styles.statusDot} style={{ background: "currentColor" }} />
        {label}
      </div>
      <div className={`${styles.mono} ${styles.addressInline}`} style={{ marginTop: 10 }}>
        {address}
      </div>
      <div className={styles.statNote}>{note}</div>
      <button type="button" className={styles.statMore} onClick={() => copy(address)}>
        {copied ? "Copied" : "Copy address"}
      </button>
    </div>
  );
};

export const AddressesScreen: React.FC<AddressesScreenProps> = ({ addAddressBookEntry, removeAddressBookEntry }) => {
  const navigate = useNavigate();
  const { addressesUnified, addressesTransparent, addressBook, currentWallet, readOnly, setSendTo } =
    useContext(ContextApp);

  const chain: ServerChainNameEnum = currentWallet?.chain_name ?? ServerChainNameEnum.mainChainName;
  const profile = swarmProfileOrActive(chain);
  const own = useMemo(
    () => deriveOwnAddresses(addressesUnified, addressesTransparent),
    [addressesUnified, addressesTransparent],
  );

  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [problem, setProblem] = useState("");
  const [checking, setChecking] = useState(false);

  const contacts = (addressBook ?? []).filter((c) => !c.chain || c.chain === chain);

  const submit = async () => {
    const trimmedLabel = label.trim();
    const trimmedAddress = address.trim();
    if (!trimmedLabel || !trimmedAddress) {
      setProblem("A contact needs both a name and an address.");
      return;
    }
    if (contacts.some((c) => c.label.toLowerCase() === trimmedLabel.toLowerCase())) {
      setProblem("There is already a contact with that name.");
      return;
    }
    setChecking(true);
    const kind = await Utils.getAddressKind(trimmedAddress, chain);
    setChecking(false);
    if (kind === undefined) {
      setProblem("That is not an address this network recognises.");
      return;
    }
    addAddressBookEntry(trimmedLabel, trimmedAddress, chain);
    setLabel("");
    setAddress("");
    setProblem("");
    setAdding(false);
  };

  const payTo = (contact: AddressBookEntryClass) => {
    const target = new ZcashURITarget();
    target.address = contact.address;
    target.label = contact.label;
    setSendTo(target);
    navigate(routes.SEND);
  };

  return (
    <>
      <section aria-label="This wallet's addresses">
        <h2 className={styles.sectionHeading}>This wallet</h2>
        <div className={styles.statGrid}>
          {own.length === 0 && (
            <div className={styles.empty}>No addresses yet — they appear once the wallet has finished opening.</div>
          )}
          {own.map((a) => (
            <OwnAddressCard
              key={a.key}
              address={a.address}
              label={a.label}
              note={a.note}
              transparent={a.kind === "transparent"}
            />
          ))}
        </div>
      </section>

      <section className={styles.panel} aria-label="Contacts">
        <div className={styles.panelHead}>
          <div className={styles.panelTitle}>Contacts</div>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSmall}`}
            onClick={() => setAdding((v) => !v)}
            aria-expanded={adding}
          >
            <SwarmIcon name="plus" size={13} /> Add contact
          </button>
        </div>

        {adding && (
          <div className={styles.addContact}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="swarm-contact-name">
                Name
              </label>
              <input
                id="swarm-contact-name"
                className={`${styles.input} ${styles.inputText}`}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Who is this?"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="swarm-contact-address">
                Address
              </label>
              <input
                id="swarm-contact-address"
                className={styles.input}
                value={address}
                spellCheck={false}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={addressPlaceholderFor(profile)}
              />
            </div>
            <div className={styles.addContactActions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSmall}`}
                onClick={submit}
                disabled={checking}
              >
                {checking ? "Checking…" : "Save contact"}
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSmall}`}
                onClick={() => {
                  setAdding(false);
                  setProblem("");
                }}
              >
                Cancel
              </button>
            </div>
            {problem && (
              <div className={styles.fieldBad} role="alert">
                <SwarmIcon name="warning" size={13} /> {problem}
              </div>
            )}
          </div>
        )}

        <div className={styles.panelBody}>
          {contacts.length === 0 ? (
            <div className={styles.empty}>
              No contacts yet. Saving one means never pasting that address again — and never pasting it wrong.
            </div>
          ) : (
            contacts.map((c) => (
              <div key={`${c.label}-${c.address}`} className={styles.rowItem} style={{ cursor: "default" }}>
                <span className={styles.contactMark} aria-hidden="true">
                  {c.label.slice(0, 2).toUpperCase()}
                </span>
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>{c.label}</span>
                  <span className={styles.rowMeta}>{abbreviate(c.address, 14)}</span>
                </span>
                <span className={styles.contactActions}>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnSmall}`}
                    onClick={() => payTo(c)}
                    disabled={readOnly}
                  >
                    Send
                  </button>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnSmall}`}
                    onClick={() => removeAddressBookEntry(c.label, c.address)}
                    aria-label={`Remove ${c.label}`}
                  >
                    Remove
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
};

export default AddressesScreen;
