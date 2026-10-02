import RPC from "./rpc";
import { native } from "../electronBridge";

jest.mock("../electronBridge", () => ({
  native: { send: jest.fn(), confirm: jest.fn() },
  ipcRenderer: { invoke: jest.fn(), on: jest.fn(() => () => {}), send: jest.fn() },
  clipboard: {},
  shell: {},
  fs: {},
  isSandboxed: false,
}));

const send = native.send as jest.Mock;
const confirm = native.confirm as jest.Mock;

function client() {
  const rpc = Object.create(RPC.prototype) as RPC;
  rpc.clearTimers = jest.fn().mockResolvedValue(undefined);
  rpc.configure = jest.fn().mockResolvedValue(undefined);
  rpc.fnSetFetchError = jest.fn();
  // A wallet on a SWARM network. Sending refuses outright for anything else
  // (see serverIdentityGate.test.ts), and this suite is about the overlapping
  // payment guard, not about which chain the wallet is on.
  rpc.currentWallet = {
    id: 1,
    chain_name: "swarm-mainnet",
    uri: "https://lwd-main.swarm.green:443",
  } as unknown as RPC["currentWallet"];
  return rpc;
}

beforeEach(() => {
  jest.clearAllMocks();
  send.mockResolvedValue("{}");
  confirm.mockResolvedValue(JSON.stringify({ txids: ["accepted-tx"] }));
});

it("rejects a second payment while the first proof is pending, even on another RPC instance", async () => {
  let finish!: (value: string) => void;
  confirm.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const first = client().sendTransaction([]);
  // Let the server-identity check, the proposal and the start of the proof all
  // settle. Counting microtasks broke the moment the send path grew the chain
  // check in front of it; draining the queue does not care how many there are.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(confirm).toHaveBeenCalledTimes(1);
  await expect(client().sendTransaction([])).rejects.toThrow("already being prepared or sent");
  expect(send).toHaveBeenCalledTimes(1);
  finish(JSON.stringify({ txids: ["first-tx"] }));
  await expect(first).resolves.toBe("first-tx");
  await expect(client().sendTransaction([])).resolves.toBe("accepted-tx");
  expect(confirm).toHaveBeenCalledTimes(2);
});

it("releases the guard after a failed proposal without confirming it", async () => {
  send.mockResolvedValueOnce(JSON.stringify({ error: "proposal refused" }));
  await expect(client().sendTransaction([])).rejects.toThrow("proposal refused");
  expect(confirm).not.toHaveBeenCalled();
  await expect(client().sendTransaction([])).resolves.toBe("accepted-tx");
});

it("keeps a successful transaction ID when the following wallet refresh fails", async () => {
  const rpc = client();
  (rpc.configure as jest.Mock).mockRejectedValue(new Error("refresh unavailable"));
  await expect(rpc.sendTransaction([])).resolves.toBe("accepted-tx");
  expect(rpc.fnSetFetchError).toHaveBeenCalledWith(
    "Refresh after payment",
    expect.stringContaining("refresh unavailable"),
  );
});
