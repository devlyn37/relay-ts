import { z } from "zod";

const hexWithPrefix = z.custom<`0x${string}`>((val) => {
  return /^0x[a-fA-F0-9]+$/.test(val as string);
});

const strictUUID =
  z.custom<`${string}-${string}-${string}-${string}-${string}`>((val) => {
    return /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(
      val as string
    );
  });

const status = z.union([
  z.literal("pending"),
  z.literal("complete"),
  z.literal("failed"),
]);
export type Status = z.infer<typeof status>;

const gasFees = z.union([
  z.object({
    gasPrice: z.string(),
  }),
  z.object({
    maxFeePerGas: z.string(),
    maxPriorityFeePerGas: z.string(),
  }),
]);
const deserializedGasFees = gasFees.transform((val) => {
  if ("gasPrice" in val) {
    return { gasPrice: BigInt(val.gasPrice) } as {
      gasPrice: bigint;
    };
  } else {
    return {
      maxFeePerGas: BigInt(val.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(val.maxPriorityFeePerGas),
    } as { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
  }
});
export type GasFees = z.infer<typeof deserializedGasFees>;
export type SerializedGasFees = z.infer<typeof gasFees>;

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
  data: hexWithPrefix,
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
const test = deserializedRequest.parse("a");
