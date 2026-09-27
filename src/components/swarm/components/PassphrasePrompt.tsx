import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactModal from "react-modal";
import styles from "../Swarm.module.css";

/**
 * The one place a signer passphrase is typed.
 *
 * Masked, never echoed anywhere, never put in application state that outlives
 * the call, and cleared on the way out — including when the modal is
 * dismissed rather than submitted, which is the case people forget.
 *
 * It is a modal rather than a field on the page on purpose: a passphrase
 * field sitting on a screen invites a browser, a password manager or a
 * screenshot to keep it. This one exists for the length of one signature.
 */

type Props = {
  title: string;
  explanation: string;
  onSubmit: (passphrase: string) => void | Promise<void>;
  onCancel: () => void;
};

export const PassphrasePrompt: React.FC<Props> = ({ title, explanation, onSubmit, onCancel }) => {
  const [passphrase, setPassphrase] = useState("");
  const field = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    field.current?.focus();
    // Clearing on unmount as well as on submit: dismissing the modal with
    // Escape leaves the same string in memory as pressing the button does.
    return () => setPassphrase("");
  }, []);

  const submit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (passphrase.length === 0) return;
      const typed = passphrase;
      setPassphrase("");
      void onSubmit(typed);
    },
    [passphrase, onSubmit],
  );

  const cancel = useCallback(() => {
    setPassphrase("");
    onCancel();
  }, [onCancel]);

  return (
    <ReactModal
      isOpen
      onRequestClose={cancel}
      ariaHideApp={false}
      className={`${styles.panel} ${styles.panelPad}`}
      overlayClassName={styles.popover}
      contentLabel={title}
    >
      <form onSubmit={submit}>
        <div className={styles.panelTitle}>{title}</div>
        <div className={styles.fieldNote}>{explanation}</div>
        <label className={styles.label} htmlFor="treasury-passphrase">
          Passphrase
        </label>
        <input
          id="treasury-passphrase"
          ref={field}
          className={styles.input}
          type="password"
          value={passphrase}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setPassphrase(event.target.value)}
        />
        <div className={styles.actionRow}>
          <button
            type="submit"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={passphrase.length === 0}
          >
            Continue
          </button>
          <button type="button" className={styles.btn} onClick={cancel}>
            Cancel
          </button>
        </div>
      </form>
    </ReactModal>
  );
};

export default PassphrasePrompt;
