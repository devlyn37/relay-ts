import { Chain, Hash, PublicClient, Block, Address, Hex } from "viem";
import { NonceManagedWallet } from "./NonceManagedWallet";
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
  start: "transactionStarted",
  retry: "transactionRetried",
  failRetry: "transactionRetryFailed",
  complete: "transactionCompleted",
  fail: "transactionFailed",
} as const;
export type TransactionEvent = ObjectValues<typeof TransactionEvent>;
export const TransactionEvents = objectValues(TransactionEvent);

export type TransactionStartEvent = {
  nonce: number;
  hash: Hash;
  fees: GasFees;
};

export type TransactionCompleteEvent = {
  nonce: number;
  hash: Hash;
  fees: GasFees;
};

export type TransactionRetryEvent = {
  hash: Hash;
  fees: GasFees;
};

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
  private managedWallets: NonceManagedWallet[];
  private blockRetry: number;
  private gasOracle: GasOracle;

  constructor(
    chain: Chain,
    client: PublicClient,
    managedWallets: NonceManagedWallet[],
    gasOracle: GasOracle,
    blockRetry: number
  ) {
    super({ captureRejections: true });
    this.chain = chain;
    this.client = client;
    this.managedWallets = managedWallets;
    this.blockRetry = blockRetry;
    this.gasOracle = gasOracle;

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

    const fromWallet = this.managedWallets.find(
      (wallet) => from === wallet.address
    );

    if (fromWallet === undefined) {
      throw new WalletNotFoundError(
        from,
        `wallet ${from} not managed on ${this.chain.name}`
      );
    }

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
    this.emit(`${TransactionEvent.start}-${id}`, e);
  }

  public get signers() {
    return this.managedWallets.map((w) => w.address);
  }

  // TODO what happens if there's a re-org...
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

        const block = await this.client.getBlock({ blockNumber: n });
        console.info(`Full block fetched at: ${new Date()}`);

        try {
          await this.processBlock(block);
          console.info(
            `Block fully processed, completed transactions marked, retries sent: ${new Date()}`
          );
        } catch (e) {
          console.error(
            `There was an error processing the block:\n${JSON.stringify(
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
        console.log(`transaction ${hash} has been mined`);
        this.hashToUUID.delete(hash);
        this.pending.delete(id);
        this.emit(`${TransactionEvent.complete}-${id}`);
      }
    }

    const pending = [...this.pending.entries()];
    const retries = [];

    for (const [id, txn] of pending) {
      txn.blocksSpentWaiting++;
      let oracleEstimate: GasFees | undefined = undefined;

      if (txn.blocksSpentWaiting >= this.blockRetry) {
        oracleEstimate = oracleEstimate ?? (await this.gasOracle.getCurrent()); // Let's only fetch this once
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
      const hash = await fromWallet.replace({
        ...txn,
        fees: retryFees,
        previousHash: txn.hash,
      });

      this.hashToUUID.delete(txn.hash);
      this.hashToUUID.set(hash, id);
      txn.hash = hash;
      txn.blocksSpentWaiting = 0;
      txn.fees = retryFees;
      const e: TransactionRetryEvent = { hash, fees: txn.fees };
      this.emit(`${TransactionEvent.retry}-${id}`, e);
    } catch (error) {
      this.emit(`${TransactionEvent.failRetry}-${id}`, error);
    }
  }

  private getWallet(address: Address) {
    const wallet = this.managedWallets.find((w) => w.address === address);

    if (wallet === undefined) {
      throw new WalletNotFoundError(
        address,
        `wallet ${address} not managed on ${this.chain.name}`
      );
    }

    return wallet;
  }
}
