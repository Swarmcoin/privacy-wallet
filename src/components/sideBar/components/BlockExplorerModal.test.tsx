import React from "react";
import { render, screen, fireEvent } from "../../../test-utils";
import BlockExplorerModal from "./BlockExplorerModal";
import { BlockExplorerEnum } from "../../appstate";
import { ContextApp, defaultAppState } from "../../../context/ContextAppState";
import { ACTIVE_SWARM_PROFILE } from "../../../utils/swarmNetwork";

beforeAll(() => {
  const div = document.createElement("div");
  div.setAttribute("id", "root");
  document.body.appendChild(div);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("react-modal").setAppElement("#root");
});

// Default block explorer values used by most tests. Individual tests can
// override any subset by spreading and overriding when building `contextValue`.
const defaultBlockExplorerValues = {
  blockExplorerMainnetTransaction: BlockExplorerEnum.Swarm,
  blockExplorerTestnetTransaction: BlockExplorerEnum.Swarm,
  blockExplorerMainnetAddress: BlockExplorerEnum.Swarm,
  blockExplorerTestnetAddress: BlockExplorerEnum.Swarm,
  blockExplorerMainnetTransactionCustom: "",
  blockExplorerTestnetTransactionCustom: "",
  blockExplorerMainnetAddressCustom: "",
  blockExplorerTestnetAddressCustom: "",
};

type RenderOpts = {
  modalIsOpen?: boolean;
  closeModal?: () => void;
  modalTitle?: string;
  setBlockExplorer?: jest.Mock;
  blockExplorerValues?: Partial<typeof defaultBlockExplorerValues>;
};

const renderModal = (opts: RenderOpts = {}) => {
  const {
    modalIsOpen = true,
    closeModal = jest.fn(),
    modalTitle = "Block Explorer Settings",
    setBlockExplorer = jest.fn(),
    blockExplorerValues = {},
  } = opts;

  const contextValue = {
    ...defaultAppState,
    ...defaultBlockExplorerValues,
    ...blockExplorerValues,
    setBlockExplorer,
  };

  return {
    setBlockExplorer,
    closeModal,
    ...render(
      <ContextApp.Provider value={contextValue}>
        <BlockExplorerModal modalIsOpen={modalIsOpen} closeModal={closeModal} modalTitle={modalTitle} />
      </ContextApp.Provider>,
    ),
  };
};

describe("BlockExplorerModal", () => {
  it("renders the modal title", () => {
    renderModal();
    expect(screen.getByText("Block Explorer Settings")).toBeInTheDocument();
  });

  it("renders when closed without showing content", () => {
    renderModal({ modalIsOpen: false });
    expect(screen.queryByText("Block Explorer Settings")).not.toBeInTheDocument();
  });

  it("calls closeModal when Cancel is clicked", () => {
    const { closeModal } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(closeModal).toHaveBeenCalledTimes(1);
  });

  it("shows only the active SWARM network and its official explorer", () => {
    renderModal({
      blockExplorerValues: {
        blockExplorerMainnetTransaction: BlockExplorerEnum.Custom,
        blockExplorerMainnetTransactionCustom: "https://mainnet.zcashexplorer.app/transactions/",
      },
    });
    expect(screen.getByText(ACTIVE_SWARM_PROFILE.displayName)).toBeInTheDocument();
    expect(screen.getByText(ACTIVE_SWARM_PROFILE.explorer)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText(/zcashexplorer/)).not.toBeInTheDocument();
  });

  it("saves SWARM defaults and clears stored custom explorer destinations", () => {
    const { setBlockExplorer, closeModal } = renderModal({
      blockExplorerValues: {
        blockExplorerMainnetTransaction: BlockExplorerEnum.Custom,
        blockExplorerMainnetTransactionCustom: "https://mainnet.zcashexplorer.app/transactions/",
        blockExplorerTestnetAddress: BlockExplorerEnum.Zcashexplorer,
        blockExplorerTestnetAddressCustom: "https://outside.example/",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(setBlockExplorer).toHaveBeenCalledWith(defaultBlockExplorerValues);
    expect(closeModal).toHaveBeenCalledTimes(1);
  });
});
