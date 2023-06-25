import { Hash } from "viem";
import { UUID } from "crypto";
import {
  SerializedGasFees,
  SerializedRequest,
  Status,
} from "./TypesAndValidation";

export interface RequestRepository {
  create(request: SerializedRequest): Promise<void>;
  update(
    id: UUID,
    update: {
      status?: Status;
      hash?: Hash;
      fees?: SerializedGasFees;
    }
  ): Promise<void>;
  find(id: UUID): Promise<SerializedRequest | null>;
}
