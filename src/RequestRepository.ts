import { Address, Hash, Hex } from "viem";
import { GasFees } from "./gasOracle";

type Status = "pending" | "complete" | "failed";

type Request = {
  status: Status;
  to: Address;
  from: Address;
  chainId: number;
  value: bigint;
  nonce: number;
  fees: GasFees;
  hash: Hash;
  data?: Hex;
};

export interface RequestRepository {
  create(): Promise<Request>;
  update(request: Request): Promise<Request>;
}
