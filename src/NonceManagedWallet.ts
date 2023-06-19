import {
  Chain,
  Hash,
  Address,
  Account,
  WalletClient,
  createWalletClient,
  Transport,
  Hex,
  PublicClient,
  createPublicClient,
  PrivateKeyAccount,
} from "viem";
import { GasFees } from "./gasOracle";

type RetryParams = {
  to: Address;
  value: bigint;
  nonce: number;
  fees: GasFees;
  previousHash: Hash;
  data?: Hex;
};

export class NonceRetryLimitError extends Error {
  firstNonce: number;

  constructor(nonce: number, msg: string) {
    super(msg);
    this.firstNonce = nonce;
  }
}

export class NonceManagedWallet {
  public address: Address;
  public chain: Chain;

  private managedNonce: number | undefined;
  private wallet: WalletClient;
  private client: PublicClient;
  private account: Account;
  private queue = new SequentialPromiseQueue();

  constructor(
    account: PrivateKeyAccount,
    transport: Transport,
    chain: Chain,
    initialNonce?: number
  ) {
    this.chain = chain;
    this.account = account;
    this.address = account.address;
    this.managedNonce = initialNonce;
    this.client = createPublicClient({ chain, transport });
    this.wallet = createWalletClient({
      account,
      transport,
      chain,
    });
  }

  public get nonce() {
    return this.managedNonce;
  }

  public async send(to: Address, value: bigint, fees?: GasFees, data?: Hex) {
    const callback = () => {
      return this.sendTransaction(to, value, fees, data);
    };

    return this.queue.push(callback);
  }

  public async retry(params: RetryParams) {
    const callback = () => {
      return this.retryTransaction(params);
    };

    return this.queue.push(callback);
  }

  private async sendTransaction(
    to: Address,
    value: bigint,
    fees?: GasFees,
    data?: Hex
  ): Promise<{ hash: Hash; nonce: number }> {
    if (this.managedNonce === undefined) {
      this.managedNonce = await this.client.getTransactionCount({
        address: this.address,
      });
    }
    const originalNonce = this.managedNonce;

    let nonceRetryCount = 0;
    while (nonceRetryCount < 2) {
      try {
        const nonce = this.managedNonce;
        const hash = await this.wallet.sendTransaction({
          chain: this.chain,
          account: this.account,
          to,
          value,
          data,
          nonce,
          ...fees,
        });

        this.managedNonce++;
        return { hash, nonce };
      } catch (e: any) {
        console.log(e.details);
        if (e.details === "nonce too low" || e.details === "nonce too high") {
          this.managedNonce = await this.client.getTransactionCount({
            address: this.address,
          });

          nonceRetryCount++;
        } else {
          throw e;
        }
      }
    }

    throw new NonceRetryLimitError(
      originalNonce,
      "Tried resetting nonce too many times, someone is using the account externally"
    );
  }

  // TODO object params
  private async retryTransaction({
    to,
    value,
    nonce,
    fees,
    previousHash,
    data,
  }: RetryParams) {
    try {
      return await this.wallet.sendTransaction({
        chain: this.chain,
        account: this.account,
        to,
        value,
        nonce,
        data,
        ...fees,
      });
    } catch (e: any) {
      if (e.details === "nonce too low") {
        return previousHash;
      }

      throw e;
    }
  }
}

class SequentialPromiseQueue {
  private queue: {
    callback: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (e: any) => void;
  }[] = [];
  private isProcessingQueue: boolean = false; // Flag to check if queue processing is ongoing

  public async push<T>(callback: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ callback, resolve, reject });

      if (!this.isProcessingQueue) {
        this.processQueue();
      }
    });
  }

  private async processQueue() {
    this.isProcessingQueue = true;

    while (this.queue.length > 0) {
      const { callback, resolve, reject } = this.queue.shift()!;

      try {
        const result = await callback();
        resolve(result);
      } catch (e: any) {
        reject(e);
      }
    }

    this.isProcessingQueue = false;
  }
}
