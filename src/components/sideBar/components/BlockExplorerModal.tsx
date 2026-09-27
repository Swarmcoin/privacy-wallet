import Modal from "react-modal";
import { useContext, useEffect, useState } from "react";
import cstyles from "../../common/Common.module.css";
import { BlockExplorerEnum } from "../../appstate";
import { ContextApp } from "../../../context/ContextAppState";
import ExplorerRow from "./ExplorerRow";
import { SWARM_MAINNET_PROFILE, SWARM_TESTNET_PROFILE } from "../../../utils/networkProfiles";

type BlockExplorerModalProps = {
  modalIsOpen: boolean;
  closeModal: () => void;
  modalTitle: string;
};

// The two groups of settings are the two SWARM networks: SWARM mainnet reads
// the "mainnet" fields and SWARM testnet the "testnet" ones (see
// usesMainnetExplorerSetting in src/utils/explorerLinks.ts). The headings say
// so, and each group offers that network's own explorer by its host.
const MAINNET_EXPLORER_HOST = new URL(SWARM_MAINNET_PROFILE.explorerUrl).host;
const TESTNET_EXPLORER_HOST = new URL(SWARM_TESTNET_PROFILE.explorerUrl).host;

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

  const [blockExplorerMainnetTransaction, setBlockExplorerMainnetTransaction] =
    useState<BlockExplorerEnum>(ctxMainnetTransaction);
  const [blockExplorerTestnetTransaction, setBlockExplorerTestnetTransaction] =
    useState<BlockExplorerEnum>(ctxTestnetTransaction);
  const [blockExplorerMainnetAddress, setBlockExplorerMainnetAddress] = useState<BlockExplorerEnum>(ctxMainnetAddress);
  const [blockExplorerTestnetAddress, setBlockExplorerTestnetAddress] = useState<BlockExplorerEnum>(ctxTestnetAddress);
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
    setBlockExplorerMainnetTransaction(ctxMainnetTransaction);
    setBlockExplorerTestnetTransaction(ctxTestnetTransaction);
    setBlockExplorerMainnetAddress(ctxMainnetAddress);
    setBlockExplorerTestnetAddress(ctxTestnetAddress);
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
          SWARM Mainnet
        </div>
        <ExplorerRow
          label="Transactions"
          ariaLabel="Block explorer for SWARM Mainnet transactions"
          customPlaceholder="https://mainnet.block-explorer/tx/"
          swarmExplorerHost={MAINNET_EXPLORER_HOST}
          value={blockExplorerMainnetTransaction}
          onChange={setBlockExplorerMainnetTransaction}
          customValue={blockExplorerMainnetTransactionCustom}
          onCustomChange={setBlockExplorerMainnetTransactionCustom}
        />
        <ExplorerRow
          label="Addresses"
          ariaLabel="Block explorer for SWARM Mainnet addresses"
          customPlaceholder="https://mainnet.block-explorer/address/"
          swarmExplorerHost={MAINNET_EXPLORER_HOST}
          value={blockExplorerMainnetAddress}
          onChange={setBlockExplorerMainnetAddress}
          customValue={blockExplorerMainnetAddressCustom}
          onCustomChange={setBlockExplorerMainnetAddressCustom}
        />
      </div>

      <div className={cstyles.well} style={{ marginTop: 16 }}>
        <div className={cstyles.small} style={{ opacity: 0.6, marginBottom: 12 }}>
          SWARM Testnet
        </div>
        <ExplorerRow
          label="Transactions"
          ariaLabel="Block explorer for SWARM Testnet transactions"
          customPlaceholder="https://testnet.block-explorer/tx/"
          swarmExplorerHost={TESTNET_EXPLORER_HOST}
          value={blockExplorerTestnetTransaction}
          onChange={setBlockExplorerTestnetTransaction}
          customValue={blockExplorerTestnetTransactionCustom}
          onCustomChange={setBlockExplorerTestnetTransactionCustom}
        />
        <ExplorerRow
          label="Addresses"
          ariaLabel="Block explorer for SWARM Testnet addresses"
          customPlaceholder="https://testnet.block-explorer/address/"
          swarmExplorerHost={TESTNET_EXPLORER_HOST}
          value={blockExplorerTestnetAddress}
          onChange={setBlockExplorerTestnetAddress}
          customValue={blockExplorerTestnetAddressCustom}
          onCustomChange={setBlockExplorerTestnetAddressCustom}
        />
      </div>

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
