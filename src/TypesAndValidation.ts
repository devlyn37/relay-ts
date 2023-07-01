import { Chain } from "viem";
import {
  foundry,
  goerli,
  mainnet,
  polygon,
  polygonMumbai,
  sepolia,
} from "viem/chains";
import { z } from "zod";

export type ObjectValues<T extends object> = T[keyof T];
export function objectValues<T extends object>(obj: T): T[keyof T][] {
  return Object.values(obj);
}
export function serializeWithBigInt(val: any) {
  return JSON.parse(
    JSON.stringify(val, (key: string, value: any) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
}

// TODO is this built in somewhere
export const chainIdToViemChain = new Map<number, Chain>([
  [mainnet.id, mainnet],
  [polygon.id, polygon],
  [goerli.id, goerli],
  [sepolia.id, sepolia],
  [polygonMumbai.id, polygonMumbai],
  [foundry.id, foundry],
]);

export const chainId = z.number().refine((num) => chainIdToViemChain.has(num), {
  message: `chain not supported`,
});

export const stringToBigInt = z.string().transform((s, ctx) => {
  try {
    return BigInt(s);
  } catch (e) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Not a bigint",
    });
    return z.NEVER;
  }
});

export const hexWithPrefix = z.custom<`0x${string}`>(
  (val) => {
    return /^0x[a-fA-F0-9]+$/.test(val as string);
  },
  {
    message: "Expected string to be a valid Hex",
  }
);

export const strictUUID =
  z.custom<`${string}-${string}-${string}-${string}-${string}`>(
    (val) => {
      return /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(
        val as string
      );
    },
    {
      message: "Expected string to be a valid UUID",
    }
  );

export const Status = {
  pending: "pending",
  complete: "complete",
  failed: "failed",
} as const;
export type Status = ObjectValues<typeof Status>;
const status = z.nativeEnum(Status);

const legacyGasFees = z.object({
  gasPrice: stringToBigInt,
});
const eip1559GasFees = z.object({
  maxFeePerGas: z.coerce.bigint(),
  maxPriorityFeePerGas: z.coerce.bigint(),
});
const gasFees = z.union([legacyGasFees, eip1559GasFees]);
export type GasFees = z.infer<typeof gasFees>;

export const request = z.object({
  id: strictUUID,
  status: status,
  to: hexWithPrefix,
  from: hexWithPrefix,
  chainId: z.number(),
  value: stringToBigInt, // bigint represented as string
  nonce: z.number(),
  fees: gasFees,
  hash: hexWithPrefix,
  data: hexWithPrefix.optional().nullable(),
});
export type Request = z.infer<typeof request>;

export const createRequestInput = z.object({
  chainId: chainId,
  to: hexWithPrefix,
  value: stringToBigInt,
  data: hexWithPrefix.optional(),
});
