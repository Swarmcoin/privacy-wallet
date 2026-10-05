import React, { ReactNode } from "react";
import { UNKNOWN_MIXNET_VIEW } from "../rpc/components/mixnetPresenter";
import { INITIAL_SERVER_HEALTH } from "../rpc/components/serverHealth";
import {
  AddressBookEntryClass,
  AppState,
  InfoClass,
  SendPageStateClass,
  TotalBalanceClass,
  ValueTransferClass,
  FetchErrorTypeClass,
  UnifiedAddressClass,
  TransparentAddressClass,
  SyncStatusType,
  WalletType,
  ConfirmModalClass,
  ErrorModalClass,
  BlockExplorerEnum,
} from "../components/appstate";
import { SWM_PRICE_OFF } from "../price/swmPriceTypes";

export const defaultAppState: AppState = {
  totalBalance: new TotalBalanceClass(),
  addressesUnified: [] as UnifiedAddressClass[],
  addressesTransparent: [] as TransparentAddressClass[],
  addressBook: [] as AddressBookEntryClass[],
  valueTransfers: [] as ValueTransferClass[],
  messages: [] as ValueTransferClass[],
  errorModal: new ErrorModalClass(),
  confirmModal: new ConfirmModalClass(),
  sendPageState: new SendPageStateClass(),
  swapToState: null,
  info: new InfoClass(),
  syncingStatus: {} as SyncStatusType,
  verificationProgress: null,
  readOnly: false,
  fetchError: {} as FetchErrorTypeClass,
  currentWallet: null,
  currentWalletOpenError: "",
  wallets: [] as WalletType[],
  birthday: 0,
  orchardPool: true,
  saplingPool: true,
  transparentPool: true,
  openErrorModal: () => {},
  closeErrorModal: () => {},
  openConfirmModal: () => {},
  closeConfirmModal: () => {},
  setSendTo: () => {},
  setSwapTo: () => {},
  calculateShieldFee: async () => 0,
  handleShieldButton: () => {},
  addAddressBookEntry: () => {},
  zecPrice: 0,
  swmPrice: SWM_PRICE_OFF,
  showSwmPrice: true,
  setShowSwmPrice: () => {},
  mixnetView: UNKNOWN_MIXNET_VIEW,
  serverHealth: INITIAL_SERVER_HEALTH,
  rotateServer: () => {},
  switchServer: () => {},
  delegateServerChoice: () => {},
  reopenWallet: () => {},
  avoidedServers: [],
  blockExplorerMainnetTransaction: BlockExplorerEnum.Swarm,
  blockExplorerTestnetTransaction: BlockExplorerEnum.Swarm,
  blockExplorerMainnetAddress: BlockExplorerEnum.Swarm,
  blockExplorerTestnetAddress: BlockExplorerEnum.Swarm,
  blockExplorerMainnetTransactionCustom: "",
  blockExplorerTestnetTransactionCustom: "",
  blockExplorerMainnetAddressCustom: "",
  blockExplorerTestnetAddressCustom: "",
  setBlockExplorer: () => {},
};

export const ContextApp = React.createContext(defaultAppState);

type ContextProviderProps = {
  children: ReactNode;
  value: AppState;
};

export const ContextAppProvider = ({ children, value }: ContextProviderProps) => {
  return <ContextApp.Provider value={value}>{children}</ContextApp.Provider>;
};
