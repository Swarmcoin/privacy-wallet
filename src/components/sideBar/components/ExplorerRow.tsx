import React from "react";
import cstyles from "../../common/Common.module.css";
import { BlockExplorerEnum } from "../../appstate";

export type ExplorerRowProps = {
  label: string;
  ariaLabel: string;
  customPlaceholder: string;
  /** The host of this network's SWARM explorer, shown in its option. */
  swarmExplorerHost: string;
  value: BlockExplorerEnum;
  onChange: (v: BlockExplorerEnum) => void;
  customValue: string;
  onCustomChange: (v: string) => void;
};

const ExplorerRow = ({
  label,
  ariaLabel,
  customPlaceholder,
  swarmExplorerHost,
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
          {/* No Zcash explorer is offered: none of them indexes a SWARM chain. */}
          <option value={BlockExplorerEnum.Swarm}>SWARM Explorer ({swarmExplorerHost})</option>
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
