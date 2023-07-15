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
import { GasFees } from "./TypesAndValidation";
import { sleep } from "./utils";

type ReplacementParams = {
  to: Address;
  value: bigint;
  nonce: number;
  fees: GasFees;
  data?: Hex;
};

export class NonceRetryLimitError extends Error {
  firstNonce: number;
  address: Address;

  constructor(firstNonce: number, address: Address) {
    super(
      `Tried resetting nonce ${firstNonce} too many times, someone is using the account ${address} externally`
    );
    this.firstNonce = firstNonce;
    this.address = address;
  }
}

export class NonceAlreadyIncludedError extends Error {
  nonce: number;
  address: Address;

  constructor(nonce: number, address: Address) {
    super(`nonce ${nonce} from address ${address} has already been included`);
    this.nonce = nonce;
    this.address = address;
  }
}

export class NonceManagedWallet {
  public address: Address;
  public chain: Chain;

  private managedNonce: number | undefined;
  private wallet: WalletClient;
  private client: PublicClient;
  private account: Account;
  private queue: SequentialPromiseQueue;

  constructor(
    account: PrivateKeyAccount,
    transport: Transport,
    chain: Chain,
    delayMs: number = 500,
    initialNonce?: number
  ) {
    this.chain = chain;
    this.account = account;
    this.address = account.address;
    this.managedNonce = initialNonce;
    this.queue = new SequentialPromiseQueue(delayMs);
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
    return this.queue.push(() => this.sendTransaction(to, value, fees, data));
  }

  public async replace(params: ReplacementParams) {
    return this.queue.push(() => this.replaceTransaction(params));
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

    throw new NonceRetryLimitError(originalNonce, this.address);
  }

  private async replaceTransaction({
    to,
    value,
    nonce,
    fees,
    data,
  }: ReplacementParams) {
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
        throw new NonceAlreadyIncludedError(nonce, this.address);
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
  private delayMs: number;

  constructor(delayMs: number) {
    this.delayMs = delayMs;
  }

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

      await sleep(this.delayMs);
    }

    this.isProcessingQueue = false;
  }
}
