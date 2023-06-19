import { PublicClient } from "viem";

export type GasFees =
  | { gasPrice: bigint }
  | { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

export interface GasOracle {
  getCurrent(): Promise<GasFees>;
  getRetry(prev: GasFees, current: GasFees): GasFees;
}

export class BaseGasOracle implements GasOracle {
  client: PublicClient;

  constructor(client: PublicClient) {
    this.client = client;
  }

  public async getCurrent(): Promise<GasFees> {
    const [gasPrice, block] = await Promise.all([
      this.client.getGasPrice(),
      this.client.getBlock({ blockTag: "latest" }),
    ]);

    if (block.baseFeePerGas == null) {
      return { gasPrice: this.slack(gasPrice) };
    }

    const maxFeePerGas = gasPrice;
    const maxPriorityFeePerGas = maxFeePerGas - block.baseFeePerGas;

    return {
      maxFeePerGas: this.slack(maxFeePerGas),
      maxPriorityFeePerGas: this.slack(maxPriorityFeePerGas),
    };
  }

  public getRetry(prev: GasFees, current: GasFees): GasFees {
    if ("gasPrice" in prev && "gasPrice" in current) {
      return {
        gasPrice: this.max(
          this.tenPercentLarger(prev.gasPrice),
          current.gasPrice
        ),
      };
    } else if ("maxFeePerGas" in prev && "maxFeePerGas" in current) {
      return {
        maxFeePerGas: this.max(
          this.tenPercentLarger(prev.maxFeePerGas),
          current.maxFeePerGas
        ),
        maxPriorityFeePerGas: this.max(
          this.tenPercentLarger(prev.maxPriorityFeePerGas),
          current.maxPriorityFeePerGas
        ),
      };
    } else {
      throw new Error("Mismatched gas fee formats in prev and currentEstimate");
    }
  }

  private slack(n: bigint) {
    return (n * 6n) / 5n;
  }

  private max(a: bigint, b: bigint) {
    return a > b ? a : b;
  }

  private tenPercentLarger(n: bigint) {
    const increase = (n * 10n) / 100n;
    return n + increase + 1n; // extra one for rounding purposes
  }
}
