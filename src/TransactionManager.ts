import {
  Chain,
  Hash,
  createPublicClient,
  WebSocketTransport,
  PublicClient,
  Block,
} from "viem";
import { randomUUID } from "crypto";

export class TransactionManager {
  public chain: Chain;
  public transactions: Map<string, Hash> = new Map();

  private client: PublicClient;

  constructor(chain: Chain, ws: WebSocketTransport) {
    this.chain = chain;
    this.client = createPublicClient({ chain: this.chain, transport: ws });

    this.monitorBlocks();
  }

  public send() {
    return randomUUID();
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

  private async processBlock(block: Block) {
    console.log(block.transactions);
  }
}
