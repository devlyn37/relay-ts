import { Chain, Hash, PublicClient, Block, Address, Hex } from "viem";
import { UUID, randomUUID } from "crypto";
import { NonceManagedWallet } from "./NonceManagedWallet";
import { GasFees, GasOracle } from "./gasOracle";

type TransactionData = {
  to: Address;
  value: bigint;
  nonce: number;
  blocksPending: number;
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
      blocksPending: 0,
      nonce,
      fees,
      hash,
    });

    return id;
  }

  private monitorBlocks() {
    this.client.watchBlockNumber({
      onBlockNumber: async (blockNumber) => {
        const receivedTimestamp = new Date();
        console.log("Block number received at:", receivedTimestamp);

        const block = await this.client.getBlock({ blockNumber });
        const fetchedTimestamp = new Date();
        console.log("Full block fetched at:", fetchedTimestamp);

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
    console.log(block.transactions);

    for (const txn of block.transactions) {
      const hash = typeof txn === "string" ? txn : txn.hash;
      const uuid = this.hashToUUID.get(hash);

      if (uuid !== undefined) {
        console.log(`transaction ${hash} has been mined`);
        this.hashToUUID.delete(hash);
        this.pending.delete(uuid);
      }
    }

    this.bumpPendingTransactions();
  }

  private bumpPendingTransactions() {
    const txns = [...this.pending.entries()];

    for (const [uuid, txn] of txns) {
      txn.blocksPending++;
      console.log(`blocksPending for tx ${txn.hash} ${txn.blocksPending}`);

      if (txn.blocksPending >= this.blockRetry) {
        // TODO clean this up and do less stuff here
        const test = async () => {
          try {
            const currentFees = await this.gasOracle.getCurrent();
            const retryFees = this.gasOracle.getRetry(txn.fees, currentFees);

            this.hashToUUID.delete(txn.hash);
            const hash = await this.managedWallet.replace({
              ...txn,
              fees: retryFees,
              previousHash: txn.hash,
            });

            this.hashToUUID.set(hash, uuid);
            txn.hash = hash;
            txn.blocksPending = 0;
            txn.fees = retryFees;
          } catch (e) {
            console.error(e);
          }
        };

        test();
      }
    }
  }
}
