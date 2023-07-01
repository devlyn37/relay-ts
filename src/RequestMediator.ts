import {
  TransactionCompleteEvent,
  TransactionEvent,
  TransactionManager,
  TransactionRetryEvent,
  TransactionStartEvent,
} from "./TransactionManager";
import { RequestRepository } from "./RequestRepository";
import { UUID, randomUUID } from "crypto";
import { Address, Hex } from "viem";
import { Status } from "./TypesAndValidation";

export class ChainNotFoundError extends Error {
  chainId: number;

  constructor(chainId: number) {
    super(`Chain with id ${chainId} not found`);
    this.chainId = chainId;
  }
}
export class RequestMediator {
  private transactionManagers: Map<number, TransactionManager>;
  private requestRepo: RequestRepository;
  // logger
  // tracing
  // etc...

  constructor(
    transactionManagers: Map<number, TransactionManager>,
    requestRepo: RequestRepository
  ) {
    this.transactionManagers = transactionManagers;
    this.requestRepo = requestRepo;

    // Make sure events emitted from handlers don't stop the node process
    for (const manager of transactionManagers.values()) {
      manager.on("error", (error) => {
        console.error(
          `An unhandled error occurred on the transaction manager for chain ${manager.chain.name}`,
          error
        );
      });
    }
  }

  public async start(
    chainId: number,
    to: Address,
    from: Address,
    value: bigint,
    data?: Hex
  ) {
    const id = randomUUID();

    const manager = this.getTransactionManager(chainId);
    this.setupListeners(manager, id, to, from, value, data);

    try {
      await manager.send(id, to, from, value, data);
      return id;
    } catch (error) {
      this.teardownListeners(manager, id);
      throw error;
    }
  }

  public async find(id: UUID) {
    return this.requestRepo.find(id);
  }

  private setupListeners(
    manager: TransactionManager,
    id: UUID,
    to: Address,
    from: Address,
    value: bigint,
    data?: Hex
  ) {
    manager.once(
      `${TransactionEvent.start}-${id}`,
      (e: TransactionStartEvent) => {
        this.saveStartedTransaction({
          ...e,
          chainId: manager.chain.id,
          to,
          from,
          value,
          data,
          id,
        });
      }
    );

    manager.on(
      `${TransactionEvent.retry}-${id}`,
      (e: TransactionRetryEvent) => {
        this.saveRetriedTransaction({ ...e, id });
      }
    );

    manager.on(
      `${TransactionEvent.complete}-${id}`,
      (e: TransactionCompleteEvent) => {
        this.saveCompletedTransaction(id);
      }
    );

    manager.on(`${TransactionEvent.complete}-${id}`, () => {
      console.log("Tearing down listeners, transaction complete");
      this.teardownListeners(manager, id);
    });

    // TODO Transaction Retry Failed
  }

  private teardownListeners(manager: TransactionManager, id: UUID) {
    for (const name of manager.eventNames()) {
      if (name.toString().includes(id)) {
        manager.removeAllListeners(name);
      }
    }
  }

  private async saveStartedTransaction(
    params: TransactionStartEvent & {
      id: UUID;
      chainId: number;
      from: Address;
      to: Address;
      value: bigint;
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
        chainId: params.chainId,
        value: params.value,
        nonce: params.nonce,
        fees: params.fees,
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
        fees: params.fees,
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

  private getTransactionManager(chainId: number) {
    const manager = this.transactionManagers.get(chainId);

    if (manager === undefined) {
      throw new ChainNotFoundError(chainId);
    }

    return manager;
  }
}
