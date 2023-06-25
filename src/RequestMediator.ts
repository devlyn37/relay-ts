import {
  TransactionEvent,
  TransactionManager,
  TransactionRetriedEvent,
  TransactionStartedEvent,
} from "./TransactionManager";
import { RequestRepository } from "./RequestRepository";
import { UUID, randomUUID } from "crypto";
import { Address, Hex, parseEther } from "viem";
import { serializeGasFees } from "./TypesAndValidation";

export class RequestMediator {
  private transactionManager: TransactionManager; // TODO add many for many different chains
  private requestRepo: RequestRepository;
  // logger
  // tracing
  // etc...

  constructor(
    transactionManager: TransactionManager,
    requestRepo: RequestRepository
  ) {
    this.transactionManager = transactionManager;
    this.requestRepo = requestRepo;
  }

  public async start(to: Address, value: `${number}`, data?: Hex) {
    const id = randomUUID();

    this.setupListeners(id, to, value, data);

    try {
      await this.transactionManager.send(id, to, parseEther(value), data);
    } catch (e) {
      this.teardownListeners(id);
    }
  }

  public async status(id: UUID) {
    return this.requestRepo.get(id);
  }

  private setupListeners(
    id: UUID,
    to: Address,
    value: `${number}`,
    data?: Hex
  ) {
    this.transactionManager.once(
      `${TransactionEvent.started}-${id}`,
      (e: TransactionStartedEvent) => {
        this.saveStartedTransaction({ ...e, to, value, data, id });
      }
    );

    this.transactionManager.on(
      `${TransactionEvent.retried}-${id}`,
      (e: TransactionRetriedEvent) => {
        this.saveRetriedTransaction({ ...e, id });
      }
    );

    // TODO Transaction Completed & Transaction Retry Failed
  }

  private teardownListeners(id: UUID) {
    for (const name of this.transactionManager.eventNames()) {
      if (name.toString().includes(id)) {
        this.transactionManager.removeAllListeners(name);
      }
    }
  }

  private async saveStartedTransaction(
    params: TransactionStartedEvent & {
      id: UUID;
      to: Address;
      value: `${number}`;
      data?: Hex;
    }
  ) {
    try {
      await this.requestRepo.create({
        id: params.id,
        status: "pending",
        to: params.to,
        from: this.transactionManager.signerAddress,
        chainId: this.transactionManager.chain.id,
        value: params.value,
        nonce: params.nonce,
        fees: serializeGasFees(params.fees),
        hash: params.hash,
        data: params.data,
      });
    } catch (e) {
      console.error(
        "There was an error saving the transaction to the repository"
      );
      // do something
    }
  }

  private async saveRetriedTransaction(
    params: TransactionRetriedEvent & {
      id: UUID;
    }
  ) {
    try {
      await this.requestRepo.update(
        params.id,
        "pending",
        params.hash,
        serializeGasFees(params.fees)
      );
    } catch (e) {
      console.error(
        "There was an error saving the transaction to the repository"
      );
      // do something
    }
  }
}
