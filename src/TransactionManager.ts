import { Chain, Hash, PublicClient, Block, Address, Hex } from "viem";
import { UUID, randomUUID } from "crypto";
import { NonceManagedWallet } from "./NonceManagedWallet";
import { GasFees, GasOracle } from "./gasOracle";

type TransactionData = {
  to: Address;
  value: bigint;
  nonce: number;
  blocksSpentWaiting: number;
  fees: GasFees;
  hash: Hash;
  data?: Hex;
};

export class TransactionManager {
  public chain: Chain;
  public pending: Map<UUID, TransactionData> = new Map();
  public hashToUUID: Map<Hash, UUID> = new Map();

  private client: PublicClient;
  private managedWallet: NonceManagedWallet;
  private blockRetry: number;
  private gasOracle: GasOracle;

  constructor(
    chain: Chain,
    client: PublicClient,
    managedWallet: NonceManagedWallet,
    gasOracle: GasOracle,
    blockRetry: number
  ) {
    this.chain = chain;
    this.client = client;
    this.managedWallet = managedWallet;
    this.blockRetry = blockRetry;
    this.gasOracle = gasOracle;

    this.monitorBlocks();
  }

  public async send(to: Address, value: bigint, data?: Hex) {
    const id = randomUUID();
    const fees = await this.gasOracle.getCurrent();
    const { hash, nonce } = await this.managedWallet.send(
      to,
      value,
      fees,
      data
    );
    this.hashToUUID.set(hash, id);
    this.pending.set(id, {
      to,
      value,
      data,
      blocksSpentWaiting: 0,
      nonce,
      fees,
      hash,
    });

    return id;
  }

  private monitorBlocks() {
    this.client.watchBlockNumber({
      onBlockNumber: async (blockNumber) => {
        console.log("Block number received at:", new Date());

        const block = await this.client.getBlock({ blockNumber });
        console.log("Full block fetched at:", new Date());

        try {
          await this.processBlock(block);
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
      const uuid = this.hashToUUID.get(hash);

      if (uuid !== undefined) {
        console.log(`transaction ${hash} has been mined`);
        this.hashToUUID.delete(hash);
        this.pending.delete(uuid);
      }
    }

    const pending = [...this.pending.entries()];
    const retries = [];

    for (const [uuid, txn] of pending) {
      txn.blocksSpentWaiting++;
      let oracleEstimate: GasFees | undefined = undefined;

      if (txn.blocksSpentWaiting >= this.blockRetry) {
        oracleEstimate = oracleEstimate ?? (await this.gasOracle.getCurrent()); // Let's only fetch this once
        retries.push(this.retryTransaction(uuid, txn, oracleEstimate));
      }
    }

    console.log(
      "Block fully processed, completed transactions marked, retries sent: ",
      new Date()
    );
    return Promise.all(retries);
  }

  private async retryTransaction(
    uuid: UUID,
    txn: TransactionData,
    oracleEstimate: GasFees
  ) {
    const hash = await this.managedWallet.replace({
      ...txn,
      fees: this.gasOracle.getRetry(txn.fees, oracleEstimate),
      previousHash: txn.hash,
    });

    this.hashToUUID.delete(txn.hash);
    this.hashToUUID.set(hash, uuid);
    txn.hash = hash;
    txn.blocksSpentWaiting = 0;
    txn.fees = oracleEstimate;
  }
}
