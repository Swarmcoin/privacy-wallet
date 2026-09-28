import Modal from "react-modal";
import { useContext, useEffect, useState } from "react";
import cstyles from "../../common/Common.module.css";
import { BlockExplorerEnum } from "../../appstate";
import { ContextApp } from "../../../context/ContextAppState";
import ExplorerRow from "./ExplorerRow";
import { ACTIVE_SWARM_PROFILE } from "../../../utils/swarmNetwork";
import { SwarmProfileIdEnum } from "../../../utils/networkProfiles";

/**
 * Whether this build shows the explorers for upstream's test network.
 *
 * Not on a mainnet build: a "Testnet" heading in the mainnet wallet's
 * settings is test-network wording about a network this build never opens a
 * wallet on (0.1.0-mainnet.6). The settings themselves are untouched, so a
 * testnet build shows and saves them exactly as before.
 */
const SHOW_TESTNET_EXPLORERS = ACTIVE_SWARM_PROFILE.id !== SwarmProfileIdEnum.mainnet;

type BlockExplorerModalProps = {
  modalIsOpen: boolean;
  closeModal: () => void;
  modalTitle: string;
};

/**
 * What a stored choice is shown and saved as: Custom stays Custom, and
 * anything else — an upstream Zcash explorer an earlier version defaulted
 * to, a removed one, nothing at all — is SWARM's explorer, the only other
 * choice there is.
 */
export const shownExplorer = (stored: BlockExplorerEnum | string | undefined): BlockExplorerEnum =>
  stored === BlockExplorerEnum.Custom ? BlockExplorerEnum.Custom : BlockExplorerEnum.Swarm;

const normalizeCustom = (selected: BlockExplorerEnum, value: string) => {
  if (selected !== BlockExplorerEnum.Custom) return "";
  return value.endsWith("/") || value.endsWith("=") ? value : `${value}/`;
};

const BlockExplorerModal = ({ modalIsOpen, closeModal, modalTitle }: BlockExplorerModalProps) => {
  // Source of truth lives in context (kept in sync with electron-settings by
  // setBlockExplorer in Routes.tsx). Local draft state lets the user edit the
  // form without committing until they press Save.
  const {
    blockExplorerMainnetTransaction: ctxMainnetTransaction,
    blockExplorerTestnetTransaction: ctxTestnetTransaction,
    blockExplorerMainnetAddress: ctxMainnetAddress,
    blockExplorerTestnetAddress: ctxTestnetAddress,
    blockExplorerMainnetTransactionCustom: ctxMainnetTransactionCustom,
    blockExplorerTestnetTransactionCustom: ctxTestnetTransactionCustom,
    blockExplorerMainnetAddressCustom: ctxMainnetAddressCustom,
    blockExplorerTestnetAddressCustom: ctxTestnetAddressCustom,
    setBlockExplorer,
  } = useContext(ContextApp);

  const [blockExplorerMainnetTransaction, setBlockExplorerMainnetTransaction] = useState<BlockExplorerEnum>(
    shownExplorer(ctxMainnetTransaction),
  );
  const [blockExplorerTestnetTransaction, setBlockExplorerTestnetTransaction] = useState<BlockExplorerEnum>(
    shownExplorer(ctxTestnetTransaction),
  );
  const [blockExplorerMainnetAddress, setBlockExplorerMainnetAddress] = useState<BlockExplorerEnum>(
    shownExplorer(ctxMainnetAddress),
  );
  const [blockExplorerTestnetAddress, setBlockExplorerTestnetAddress] = useState<BlockExplorerEnum>(
    shownExplorer(ctxTestnetAddress),
  );
  const [blockExplorerMainnetTransactionCustom, setBlockExplorerMainnetTransactionCustom] =
    useState<string>(ctxMainnetTransactionCustom);
  const [blockExplorerTestnetTransactionCustom, setBlockExplorerTestnetTransactionCustom] =
    useState<string>(ctxTestnetTransactionCustom);
  const [blockExplorerMainnetAddressCustom, setBlockExplorerMainnetAddressCustom] =
    useState<string>(ctxMainnetAddressCustom);
  const [blockExplorerTestnetAddressCustom, setBlockExplorerTestnetAddressCustom] =
    useState<string>(ctxTestnetAddressCustom);

  // Re-sync the local draft with context every time the modal opens, so
  // reopening doesn't leak the previous session's edits if the user
  // cancelled (or the values were changed elsewhere).
  useEffect(() => {
    if (!modalIsOpen) return;
    setBlockExplorerMainnetTransaction(shownExplorer(ctxMainnetTransaction));
    setBlockExplorerTestnetTransaction(shownExplorer(ctxTestnetTransaction));
    setBlockExplorerMainnetAddress(shownExplorer(ctxMainnetAddress));
    setBlockExplorerTestnetAddress(shownExplorer(ctxTestnetAddress));
    setBlockExplorerMainnetTransactionCustom(ctxMainnetTransactionCustom);
    setBlockExplorerTestnetTransactionCustom(ctxTestnetTransactionCustom);
    setBlockExplorerMainnetAddressCustom(ctxMainnetAddressCustom);
    setBlockExplorerTestnetAddressCustom(ctxTestnetAddressCustom);
  }, [
    modalIsOpen,
    ctxMainnetTransaction,
    ctxTestnetTransaction,
    ctxMainnetAddress,
    ctxTestnetAddress,
    ctxMainnetTransactionCustom,
    ctxTestnetTransactionCustom,
    ctxMainnetAddressCustom,
    ctxTestnetAddressCustom,
  ]);

  const handleCancel = () => {
    // Just close — the next time the modal opens, the effect above re-syncs
    // the draft from context.
    closeModal();
  };

  const handleSave = () => {
    const toSave = {
      blockExplorerMainnetAddress,
      blockExplorerMainnetAddressCustom: normalizeCustom(
        blockExplorerMainnetAddress,
        blockExplorerMainnetAddressCustom,
      ),
      blockExplorerMainnetTransaction,
      blockExplorerMainnetTransactionCustom: normalizeCustom(
        blockExplorerMainnetTransaction,
        blockExplorerMainnetTransactionCustom,
      ),
      blockExplorerTestnetAddress,
      blockExplorerTestnetAddressCustom: normalizeCustom(
        blockExplorerTestnetAddress,
        blockExplorerTestnetAddressCustom,
      ),
      blockExplorerTestnetTransaction,
      blockExplorerTestnetTransactionCustom: normalizeCustom(
        blockExplorerTestnetTransaction,
        blockExplorerTestnetTransactionCustom,
      ),
    };
    setBlockExplorer(toSave);
    closeModal();
  };

  const saveDisabled =
    (blockExplorerMainnetAddress === BlockExplorerEnum.Custom && !blockExplorerMainnetAddressCustom) ||
    (blockExplorerMainnetTransaction === BlockExplorerEnum.Custom && !blockExplorerMainnetTransactionCustom) ||
    (blockExplorerTestnetAddress === BlockExplorerEnum.Custom && !blockExplorerTestnetAddressCustom) ||
    (blockExplorerTestnetTransaction === BlockExplorerEnum.Custom && !blockExplorerTestnetTransactionCustom);

  return (
    <Modal
      isOpen={modalIsOpen}
      onRequestClose={closeModal}
      className={cstyles.centredsheet}
      overlayClassName={cstyles.modalOverlay}
      style={{ content: { maxWidth: 640 } }}
    >
      <div className={`${cstyles.xlarge} ${cstyles.center}`}>{modalTitle}</div>

      <div className={`${cstyles.well} ${cstyles.margintopsmall}`} style={{ marginTop: 24 }}>
        <div className={cstyles.small} style={{ opacity: 0.6, marginBottom: 12 }}>
          Mainnet
        </div>
        <ExplorerRow
          label="Transactions"
          ariaLabel="Block explorer for mainnet transactions"
          customPlaceholder="https://mainnet.block-explorer/tx/"
          value={blockExplorerMainnetTransaction}
          onChange={setBlockExplorerMainnetTransaction}
          customValue={blockExplorerMainnetTransactionCustom}
          onCustomChange={setBlockExplorerMainnetTransactionCustom}
        />
        <ExplorerRow
          label="Addresses"
          ariaLabel="Block explorer for mainnet addresses"
          customPlaceholder="https://mainnet.block-explorer/address/"
          value={blockExplorerMainnetAddress}
          onChange={setBlockExplorerMainnetAddress}
          customValue={blockExplorerMainnetAddressCustom}
          onCustomChange={setBlockExplorerMainnetAddressCustom}
        />
      </div>

      {SHOW_TESTNET_EXPLORERS && (
        <div className={cstyles.well} style={{ marginTop: 16 }}>
          <div className={cstyles.small} style={{ opacity: 0.6, marginBottom: 12 }}>
            Testnet
          </div>
          <ExplorerRow
            label="Transactions"
            ariaLabel="Block explorer for testnet transactions"
            customPlaceholder="https://testnet.block-explorer/tx/"
            value={blockExplorerTestnetTransaction}
            onChange={setBlockExplorerTestnetTransaction}
            customValue={blockExplorerTestnetTransactionCustom}
            onCustomChange={setBlockExplorerTestnetTransactionCustom}
          />
          <ExplorerRow
            label="Addresses"
            ariaLabel="Block explorer for testnet addresses"
            customPlaceholder="https://testnet.block-explorer/address/"
            value={blockExplorerTestnetAddress}
            onChange={setBlockExplorerTestnetAddress}
            customValue={blockExplorerTestnetAddressCustom}
            onCustomChange={setBlockExplorerTestnetAddressCustom}
          />
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
        <button type="button" className={cstyles.primarybutton} onClick={handleCancel}>
          Cancel
        </button>
        <button type="button" className={cstyles.primarybutton} onClick={handleSave} disabled={saveDisabled}>
          Save
        </button>
      </div>
    </Modal>
  );
};

export default BlockExplorerModal;
