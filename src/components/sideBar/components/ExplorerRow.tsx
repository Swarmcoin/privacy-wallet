import cstyles from "../../common/Common.module.css";

export type ExplorerRowProps = {
  label: string;
  explorer: string;
};

const ExplorerRow = ({ label, explorer }: ExplorerRowProps) => (
  <div style={{ marginBottom: 12 }}>
    <div className={cstyles.small}>{label}</div>
    <div>SWARM Explorer</div>
    <div className={cstyles.small}>{explorer}</div>
  </div>
);

export default ExplorerRow;
