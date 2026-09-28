import React from "react";
import cstyles from "../../common/Common.module.css";
import { BlockExplorerEnum } from "../../appstate";

export type ExplorerRowProps = {
  label: string;
  ariaLabel: string;
  customPlaceholder: string;
  value: BlockExplorerEnum;
  onChange: (v: BlockExplorerEnum) => void;
  customValue: string;
  onCustomChange: (v: string) => void;
};

const ExplorerRow = ({
  label,
  ariaLabel,
  customPlaceholder,
  value,
  onChange,
  customValue,
  onCustomChange,
}: ExplorerRowProps) => {
  const isCustom = value === BlockExplorerEnum.Custom;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className={cstyles.small}>{label}</div>
        <select
          aria-label={ariaLabel}
          className={cstyles.fieldselect}
          style={{ marginLeft: 16, minWidth: 220 }}
          value={value}
          onChange={(e) => onChange(e.target.value as BlockExplorerEnum)}
        >
          <option value="" disabled hidden>
            Select…
          </option>
          {/*
            SWARM's explorer for the wallet's network, or one the user types.
            Upstream's three Zcash explorers were offered here until
            0.1.0-mainnet.7; none of them has ever seen a SWARM transaction.
          */}
          <option value={BlockExplorerEnum.Swarm}>SWARM Explorer</option>
          <option value={BlockExplorerEnum.Custom}>Custom</option>
        </select>
      </div>
      {isCustom && (
        <div className={cstyles.fieldrow} style={{ marginTop: 8 }}>
          <input
            aria-label={`${ariaLabel} custom URL`}
            type="text"
            className={cstyles.fieldinput}
            placeholder={customPlaceholder}
            value={customValue}
            onChange={(e) => onCustomChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
};

export default ExplorerRow;
