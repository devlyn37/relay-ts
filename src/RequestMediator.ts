import {
  TransactionCompleteEvent,
  TransactionEvent,
  TransactionManager,
  TransactionRetryEvent,
  TransactionStartEvent,
} from "./TransactionManager";
import { RequestRepository } from "./RequestRepository";
import { UUID, randomUUID } from "crypto";
import { Address, Hex, parseEther } from "viem";
import { Status, serializeGasFees } from "./TypesAndValidation";

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

  public async start(
    to: Address,
    from: Address,
    value: `${number}`,
    data?: Hex
  ) {
    const id = randomUUID();

    this.setupListeners(id, to, from, value, data);

    try {
      await this.transactionManager.send(id, to, from, parseEther(value), data);
      return id;
    } catch (error) {
      this.teardownListeners(id);
      throw error;
    }
  }

  public async find(id: UUID) {
    return this.requestRepo.find(id);
  }

  private setupListeners(
    id: UUID,
    to: Address,
    from: Address,
    value: `${number}`,
    data?: Hex
  ) {
    this.transactionManager.once(
      `${TransactionEvent.start}-${id}`,
      (e: TransactionStartEvent) => {
        this.saveStartedTransaction({ ...e, to, from, value, data, id });
      }
    );

    this.transactionManager.on(
      `${TransactionEvent.retry}-${id}`,
      (e: TransactionRetryEvent) => {
        this.saveRetriedTransaction({ ...e, id });
      }
    );

    this.transactionManager.on(
      `${TransactionEvent.complete}-${id}`,
      (e: TransactionCompleteEvent) => {
        this.saveCompletedTransaction(id);
      }
    );

    this.transactionManager.on(`${TransactionEvent.complete}-${id}`, () => {
      this.teardownListeners(id);
    });

    // TODO Transaction Retry Failed
  }

  private teardownListeners(id: UUID) {
    for (const name of this.transactionManager.eventNames()) {
      if (name.toString().includes(id)) {
        this.transactionManager.removeAllListeners(name);
      }
    }
  }

  private async saveStartedTransaction(
    params: TransactionStartEvent & {
      id: UUID;
      from: Address;
      to: Address;
      value: `${number}`;
      data?: Hex;
    }
  ) {
    console.info(`Transaction ${params.id} has been sent, saving to db`);
    try {
      await this.requestRepo.create({
        id: params.id,
        status: Status.pending,
        to: params.to,
        from: params.from,
        chainId: this.transactionManager.chain.id,
        value: params.value,
        nonce: params.nonce,
        fees: serializeGasFees(params.fees),
        hash: params.hash,
        data: params.data,
      });
      console.info(`Finished saving transaction ${params.id}`);
    } catch (e) {
      console.error(
        "There was an error saving the transaction to the repository"
      );
      // do something
    }
  }

  private async saveRetriedTransaction(
    params: TransactionRetryEvent & {
      id: UUID;
    }
  ) {
    try {
      console.info(
        `Retried transaction ${params.id}\n${JSON.stringify(
          params,
          undefined,
          2
        )}`
      );
      await this.requestRepo.update(params.id, {
        hash: params.hash,
        fees: serializeGasFees(params.fees),
      });
      console.info(`Finished updating the database`);
    } catch (e) {
      console.error(
        "There was an error saving the transaction to the repository"
      );
      // do something
    }
  }
  private async saveCompletedTransaction(id: UUID) {
    try {
      console.info(`transaction ${id} complete`);
      await this.requestRepo.update(id, {
        status: Status.complete,
      });
      console.info(`done saving`);
    } catch (e) {
      console.error(
        "There was an error saving the transaction to the repository"
      );
      // do something
    }
  }
}
