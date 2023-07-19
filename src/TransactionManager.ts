import { Chain, Hash, PublicClient, Block, Address, Hex } from "viem";
import {
  NonceAlreadyIncludedError,
  NonceManagedWallet,
} from "./NonceManagedWallet";
import { GasOracle } from "./gasOracle";
import EventEmitter from "events";
import { GasFees, ObjectValues, objectValues } from "./TypesAndValidation";

// Event Types

export const TransactionEvent = {
  submitted: "transactionSubmitted",
  retry: "transactionRetried",
  failRetry: "transactionRetryFailed",
  included: "transactionIncluded",
  cancel: "transactionCancelled",
  failCancel: "transactionCancelFailed",
  processingBlockFailed: "processingBlockFailed",
} as const;
export type TransactionEvent = ObjectValues<typeof TransactionEvent>;
export const TransactionEvents = objectValues(TransactionEvent);

export type TransactionRetriedEvent = {
  hash: Hash;
  fees: GasFees;
};
export type TransactionSubmittedEvent = TransactionRetriedEvent & {
  nonce: number;
};
export type TransactionCancelledEvent = TransactionRetriedEvent;
export type TransactionIncludedEvent = TransactionSubmittedEvent;

// Custom Errors
export class DuplicateIdError extends Error {
  public id: string;

  constructor(id: string, message: string) {
    super(message);
    this.id = id;
  }
}

export class WalletNotFoundError extends Error {
  public address: string;

  constructor(address: string, message: string) {
    super(message);
    this.address = address;
  }
}

// Standard Types

type TransactionData = {
  to: Address;
  from: Address;
  value: bigint;
  nonce: number;
  blocksSpentWaiting: number;
  fees: GasFees;
  hash: Hash;
  data?: Hex;
};

type TransactionManagerConfig = {
  chain: Chain;
  client: PublicClient;
  managedWallets: Map<Address, NonceManagedWallet>;
  gasOracle: GasOracle;
  blockRetry: number;
  blockCancel: number;
};

export class TransactionManager extends EventEmitter {
  public chain: Chain;
  public pending: Map<string, TransactionData> = new Map();
  public hashToUUID: Map<Hash, string> = new Map();
  public client: PublicClient;

  private managedWallets: Map<Address, NonceManagedWallet>;
  private blockRetry: number;
  private blockCancel: number;
  private gasOracle: GasOracle;

  constructor(config: TransactionManagerConfig) {
    super({ captureRejections: true });
    this.chain = config.chain;
    this.client = config.client;
    this.managedWallets = config.managedWallets;
    this.blockRetry = config.blockRetry;
    this.gasOracle = config.gasOracle;
    this.blockCancel = config.blockCancel;

    this.monitorBlocks();
  }

  public async send(
    id: string,
    to: Address,
    from: Address,
    value: bigint,
    data?: Hex
  ) {
    if (this.pending.has(id)) {
      throw new DuplicateIdError(
        id,
        `Transaction with id ${id} has already been sent`
      );
    }

    const fromWallet = this.getWallet(from);
    const fees = await this.gasOracle.getCurrent();
    const { hash, nonce } = await fromWallet.send(to, value, fees, data);

    this.hashToUUID.set(hash, id);
    this.pending.set(id, {
      to,
      from,
      value,
      data,
      blocksSpentWaiting: 0,
      nonce,
      fees,
      hash,
    });

    const e: TransactionSubmittedEvent = { nonce, hash, fees };
    this.emit(`${TransactionEvent.submitted}-${id}`, e);
  }

  // Note: this doesn't account for re-orgs
  private monitorBlocks() {
    this.client.watchBlockNumber({
      onBlockNumber: async (n) => {
        console.info(
          `Block number ${n} received from chain ${
            this.chain.name
          } at ${new Date()}`
        );

        try {
          const block = await this.client.getBlock({ blockNumber: n });
          console.info(`Full block fetched at: ${new Date()}`);

          await this.processBlock(block);
          console.info(
            `Block fully processed, completed transactions marked, retries sent: ${new Date()}`
          );
        } catch (e) {
          // This means there's been an unexpected error, which will require intervention
          // an event subscriber should decide how to handler this.
          this.emit(TransactionEvent.processingBlockFailed);
        }
      },
    });
  }

  private async processBlock(block: Block) {
    for (const txn of block.transactions) {
      const hash = typeof txn === "string" ? txn : txn.hash;
      const id = this.hashToUUID.get(hash);

      if (id !== undefined) {
        this.processIncluded(id, hash);
      }
    }

    const retries = [];
    let oracleEstimate: GasFees | undefined = undefined;

    for (const [id, txn] of this.pending.entries()) {
      txn.blocksSpentWaiting++;

      const shouldCancel = txn.blocksSpentWaiting >= this.blockCancel;
      const shouldRetry =
        txn.blocksSpentWaiting >= this.blockRetry &&
        txn.blocksSpentWaiting % this.blockRetry === 0;

      if (shouldCancel) {
        oracleEstimate = oracleEstimate ?? (await this.gasOracle.getCurrent()); // Let's only fetch this once
        retries.push(this.cancelTransaction(id, txn, oracleEstimate));
      } else if (shouldRetry) {
        oracleEstimate = oracleEstimate ?? (await this.gasOracle.getCurrent());
        retries.push(this.retryTransaction(id, txn, oracleEstimate));
      }
    }

    return Promise.all(retries);
  }

  private async retryTransaction(
    id: string,
    txn: TransactionData,
    oracleEstimate: GasFees
  ) {
    try {
      const retryFees = this.gasOracle.getRetry(txn.fees, oracleEstimate);
      const fromWallet = this.getWallet(txn.from);

      let hash: Hash;

      try {
        hash = await fromWallet.replace({
          ...txn,
          fees: retryFees,
        });
      } catch (e) {
        if (e instanceof NonceAlreadyIncludedError) {
          this.processIncluded(id, txn.hash);
        }

        throw e;
      }

      this.hashToUUID.delete(txn.hash);
      this.hashToUUID.set(hash, id);

      // TODO this is dirty, remember when you wrote this in rust XD, fix this
      txn.hash = hash;
      txn.blocksSpentWaiting = 0;
      txn.fees = retryFees;

      const e: TransactionRetriedEvent = { hash, fees: txn.fees };
      return this.emit(`${TransactionEvent.retry}-${id}`, e);
    } catch (error) {
      return this.emit(`${TransactionEvent.failRetry}-${id}`, error);
    }
  }

  private async cancelTransaction(
    id: string,
    txn: TransactionData,
    oracleEstimate: GasFees
  ) {
    try {
      const retryFees = this.gasOracle.getRetry(txn.fees, oracleEstimate);
      const fromWallet = this.getWallet(txn.from);

      let hash: Hash;
      try {
        hash = hash = await fromWallet.replace({
          nonce: txn.nonce,
          to: "0xe898bbd704cce799e9593a9ade2c1ca0351ab660",
          value: 0n,
          fees: retryFees,
        });
      } catch (e) {
        if (e instanceof NonceAlreadyIncludedError) {
          this.processIncluded(id, txn.hash);
        }

        throw e;
      }

      // At this point we no longer track the transaction
      this.hashToUUID.delete(txn.hash);
      this.pending.delete(id);

      // If the cancellation transaction fails or times out, intervention will be needed.
      // That's beyond the scope of this class and can be handled by subscribers to the
      // cancellation failure event.
      await this.client.waitForTransactionReceipt({ hash });

      const event: TransactionCancelledEvent = { hash, fees: txn.fees };
      return this.emit(`${TransactionEvent.cancel}-${id}`, event);
    } catch (error) {
      return this.emit(`${TransactionEvent.failCancel}-${id}`, error);
    }
  }

  private processIncluded(id: string, hash: Hash) {
    const current = this.pending.get(id);

    if (current === undefined) {
      throw new Error("ahh this shouldn't happen");
    }

    const event: TransactionIncludedEvent = {
      hash: current.hash,
      fees: current.fees,
      nonce: current.nonce,
    };

    this.pending.delete(id);
    this.hashToUUID.delete(hash);
    this.emit(`${TransactionEvent.included}-${id}`, event);
  }

  private getWallet(address: Address) {
    const wallet = this.managedWallets.get(address);

    if (wallet === undefined) {
      throw new WalletNotFoundError(
        address,
        `wallet ${address} not managed on ${this.chain.name}`
      );
    }

    return wallet;
  }
}
