import { Chain, Hash, PublicClient, Block, Address, Hex } from "viem";
import {
  NonceAlreadyIncludedError,
  NonceManagedWallet,
} from "./NonceManagedWallet";
import { GasOracle } from "./gasOracle";
import EventEmitter from "events";
import { GasFees, ObjectValues, objectValues } from "./TypesAndValidation";

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

export const TransactionEvent = {
  submitted: "transactionSubmitted",
  retry: "transactionRetried",
  failRetry: "transactionRetryFailed",
  included: "transactionIncluded",
  cancel: "transactionCancelled",
  failCancel: "transactionCancelFailed",
} as const;
export type TransactionEvent = ObjectValues<typeof TransactionEvent>;
export const TransactionEvents = objectValues(TransactionEvent);

export type TransactionRetryEvent = {
  hash: Hash;
  fees: GasFees;
};
export type TransactionStartEvent = TransactionRetryEvent & {
  nonce: number;
};
export type TransactionCancelEvent = TransactionRetryEvent;
export type TransactionIncludedEvent = TransactionStartEvent;

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

export class TransactionManager extends EventEmitter {
  public chain: Chain;
  public pending: Map<string, TransactionData> = new Map();
  public hashToUUID: Map<Hash, string> = new Map();

  private client: PublicClient;
  private managedWallets: Map<Address, NonceManagedWallet>;
  private blockRetry: number;
  private blockCancel: number;
  private gasOracle: GasOracle;

  constructor(
    chain: Chain,
    client: PublicClient,
    managedWallets: Map<Address, NonceManagedWallet>,
    gasOracle: GasOracle,
    blockRetry: number,
    blockCancel: number
  ) {
    super({ captureRejections: true });
    this.chain = chain;
    this.client = client;
    this.managedWallets = managedWallets;
    this.blockRetry = blockRetry;
    this.gasOracle = gasOracle;
    this.blockCancel = blockCancel;

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

    const e: TransactionStartEvent = { nonce, hash, fees };
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

        // TODO race conditions here?
        if (this.pending.size === 0) {
          return;
        }

        try {
          const block = await this.client.getBlock({ blockNumber: n });
          console.info(`Full block fetched at: ${new Date()}`);

          await this.processBlock(block);
          console.info(
            `Block fully processed, completed transactions marked, retries sent: ${new Date()}`
          );
        } catch (e) {
          console.error(
            `There was an error fetching or processing the block:\n${JSON.stringify(
              e,
              undefined,
              2
            )}`
          );
        }
      },
    });
  }

  private async processBlock(block: Block) {
    for (const txn of block.transactions) {
      const hash = typeof txn === "string" ? txn : txn.hash;
      const id = this.hashToUUID.get(hash);

      if (id !== undefined) {
        this.hashToUUID.delete(hash);
        this.pending.delete(id);
        this.emit(`${TransactionEvent.included}-${id}`);
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
          this.hashToUUID.delete(txn.hash);
          this.pending.delete(id);
          return this.emit(`${TransactionEvent.included}-${id}`);
        }

        throw e;
      }

      this.hashToUUID.delete(txn.hash);
      this.hashToUUID.set(hash, id);

      // TODO this is dirty, remember when you wrote this in rust XD, fix this
      txn.hash = hash;
      txn.blocksSpentWaiting = 0;
      txn.fees = retryFees;

      const e: TransactionRetryEvent = { hash, fees: txn.fees };
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
          this.hashToUUID.delete(txn.hash);
          this.pending.delete(id);
          return this.emit(`${TransactionEvent.included}-${id}`);
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

      const event: TransactionCancelEvent = { hash, fees: txn.fees };
      return this.emit(`${TransactionEvent.cancel}-${id}`, event);
    } catch (error) {
      return this.emit(`${TransactionEvent.failCancel}-${id}`, error);
    }
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
