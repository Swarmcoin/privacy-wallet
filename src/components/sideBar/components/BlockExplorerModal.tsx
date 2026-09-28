import Modal from "react-modal";
import { useContext } from "react";
import cstyles from "../../common/Common.module.css";
import { ContextApp } from "../../../context/ContextAppState";
import ExplorerRow from "./ExplorerRow";
import { ACTIVE_SWARM_PROFILE } from "../../../utils/swarmNetwork";
import { swarmExplorerSettings } from "../../../utils/explorerSettings";

type BlockExplorerModalProps = {
  modalIsOpen: boolean;
  closeModal: () => void;
  modalTitle: string;
};

const BlockExplorerModal = ({ modalIsOpen, closeModal, modalTitle }: BlockExplorerModalProps) => {
  const { setBlockExplorer } = useContext(ContextApp);
  const handleSave = () => {
    setBlockExplorer(swarmExplorerSettings());
    closeModal();
  };

  return (
    <Modal
      isOpen={modalIsOpen}
      onRequestClose={closeModal}
      className={cstyles.centredsheet}
      overlayClassName={cstyles.modalOverlay}
      style={{ content: { maxWidth: 640 } }}
    >
      <div className={`${cstyles.xlarge} ${cstyles.center}`}>{modalTitle}</div>
      <div className={cstyles.well} style={{ marginTop: 24 }}>
        <ExplorerRow label={ACTIVE_SWARM_PROFILE.displayName} explorer={ACTIVE_SWARM_PROFILE.explorer} />
        <p>Transaction and transparent address links open the SWARM explorer for this network.</p>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
        <button type="button" className={cstyles.primarybutton} onClick={closeModal}>
          Cancel
        </button>
        <button type="button" className={cstyles.primarybutton} onClick={handleSave}>
          Save
        </button>
      </div>
    </Modal>
  );
};

export default BlockExplorerModal;
