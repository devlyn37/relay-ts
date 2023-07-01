import { Hash } from "viem";
import { UUID } from "crypto";
import { GasFees, Status, Request } from "./TypesAndValidation";

export interface RequestRepository {
  create(request: Request): Promise<void>;
  update(
    id: UUID,
    update: {
      status?: Status;
      hash?: Hash;
      fees?: GasFees;
    }
  ): Promise<void>;
  find(id: UUID): Promise<Request | null>;
}
