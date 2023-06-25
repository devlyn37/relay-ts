import { z } from "zod";

export type ObjectValues<T extends object> = T[keyof T];
export function objectValues<T extends object>(obj: T): T[keyof T][] {
  return Object.values(obj);
}

const hexWithPrefix = z.custom<`0x${string}`>((val) => {
  return /^0x[a-fA-F0-9]+$/.test(val as string);
});

const strictUUID =
  z.custom<`${string}-${string}-${string}-${string}-${string}`>((val) => {
    return /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(
      val as string
    );
  });

export const Status = {
  pending: "pending",
  complete: "complete",
  failed: "failed",
} as const;
export type Status = ObjectValues<typeof Status>;
const status = z.nativeEnum(Status);

const gasFees = z.union([
  z.object({
    gasPrice: z.string(),
  }),
  z.object({
    maxFeePerGas: z.string(),
    maxPriorityFeePerGas: z.string(),
  }),
]);
export type SerializedGasFees = z.infer<typeof gasFees>;

export function deserializeGasFees(fees: SerializedGasFees) {
  if ("gasPrice" in fees) {
    return { gasPrice: BigInt(fees.gasPrice) } as {
      gasPrice: bigint;
    };
  } else {
    return {
      maxFeePerGas: BigInt(fees.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(fees.maxPriorityFeePerGas),
    } as { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
  }
}

const deserializedGasFees = gasFees.transform(deserializeGasFees);
export type GasFees = z.infer<typeof deserializedGasFees>;

export function serializeGasFees(fees: GasFees) {
  if ("gasPrice" in fees) {
    return { gasPrice: fees.gasPrice.toString() } as {
      gasPrice: string;
    };
  } else {
    return {
      maxFeePerGas: fees.maxFeePerGas.toString(),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
    } as { maxFeePerGas: string; maxPriorityFeePerGas: string };
  }
}

export const request = z.object({
  id: strictUUID,
  status: status,
  to: hexWithPrefix,
  from: hexWithPrefix,
  chainId: z.number(),
  value: z.string(), // bigint represented as string
  nonce: z.number(),
  fees: gasFees,
  hash: hexWithPrefix,
  data: hexWithPrefix.optional().nullable(),
});
export const deserializedRequest = request
  .extend({ fees: deserializedGasFees })
  .transform((val) => {
    return {
      ...val,
      value: BigInt(val.value),
      fees: val.fees as GasFees, // Why do I need this cast here?
    };
  });

export type SerializedRequest = z.infer<typeof request>;
export type Request = z.infer<typeof deserializedRequest>;
