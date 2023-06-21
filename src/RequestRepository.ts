import { Address, Hash, Hex } from "viem";
import { GasFees } from "./gasOracle";
import { UUID } from "crypto";

export type Status = "pending" | "complete" | "failed";

export type Request = {
  id: UUID;
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
  create(request: Request): Promise<void>;
  update(id: UUID, status: Status, hash: Hash, fees: GasFees): Promise<void>;
  get(id: UUID): Promise<Request>;
}
