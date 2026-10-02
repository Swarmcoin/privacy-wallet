import { render, screen } from "../../../test-utils";
import ExplorerRow from "./ExplorerRow";

it("shows the official explorer host as a fixed setting", () => {
  render(<ExplorerRow label="SWARM Mainnet" explorer="https://explore.swarm.green" />);
  expect(screen.getByText("SWARM Mainnet")).toBeInTheDocument();
  expect(screen.getByText("SWARM Explorer")).toBeInTheDocument();
  expect(screen.getByText("https://explore.swarm.green")).toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
