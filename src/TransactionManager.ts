import {
  Chain,
  Hash,
  createPublicClient,
  WebSocketTransport,
  PublicClient,
  Block,
  Address,
  Hex,
  PrivateKeyAccount,
} from "viem";
import { randomUUID } from "crypto";
import { NonceManagedWallet } from "./NonceManagedWallet";

export class TransactionManager {
  public chain: Chain;
  public transactions: Map<string, Hash> = new Map();

  private client: PublicClient;
  private managedWallet: NonceManagedWallet;

  constructor(
    chain: Chain,
    ws: WebSocketTransport,
    account: PrivateKeyAccount
  ) {
    this.chain = chain;
    this.client = createPublicClient({ chain: this.chain, transport: ws });
    this.managedWallet = new NonceManagedWallet(account, ws, chain);

    this.monitorBlocks();
  }

  public async send(to: Address, value: bigint, data?: Hex) {
    const id = randomUUID();
    const hash = await this.managedWallet.send(to, value, data);
    this.transactions.set(id, hash);

    return id;
  }

  private async processBlock(block: Block) {
    console.log(block.transactions);
  }

  private monitorBlocks() {
    this.client.watchBlockNumber({
      onBlockNumber: async (blockNumber) => {
        const receivedTimestamp = new Date();
        console.log("Block number received at:", receivedTimestamp);

        const block = await this.client.getBlock({ blockNumber });
        const fetchedTimestamp = new Date();
        console.log("Full block fetched at:", fetchedTimestamp);

        await this.processBlock(block);
      },
    });
  }
}
