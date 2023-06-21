import { MongoClient, Collection, Document } from "mongodb";
import { Request, RequestRepository, Status } from "./RequestRepository";
import { Address, Hash, Hex } from "viem";
import { GasFees } from "./gasOracle";
import { UUID } from "crypto";

type GasFeesDocument =
  | { gasPrice: string }
  | { maxFeePerGas: string; maxPriorityFeePerGas: string };

interface RequestDocument extends Document {
  id: UUID;
  status: Status;
  to: Address;
  from: Address;
  chainId: number;
  value: string; // store as string because MongoDB doesn't support bigint
  nonce: number;
  fees: GasFeesDocument;
  hash: string;
  data?: string;
}

export class MongoRequestRepository implements RequestRepository {
  private connectionPromise: Promise<MongoClient> | null = null;
  private collection: Collection<RequestDocument> | null = null;
  private uri: string;
  private dbName = "TreasuryService";
  private collectionName = "requests";

  constructor(uri: string) {
    this.uri = uri;
  }

  public async create(request: Request): Promise<void> {
    try {
      const collection = await this.getCollection();
      const document = this.serializeRequest(request);
      const result = await collection.insertOne(document);

      if (!result.acknowledged) {
        throw new Error("Failed to create a new request");
      }
    } catch (err) {
      console.error(`Failed to create a new request: ${err}`);
      throw err;
    }
  }

  async update(
    id: UUID,
    status: Status,
    hash: Hash,
    fees: GasFees
  ): Promise<void> {
    try {
      const collection = await this.getCollection();
      await collection.findOneAndUpdate(
        { id },
        { $set: { status, hash, fees: this.serializeGasFees(fees) } },
        { returnDocument: "after" }
      );
    } catch (err) {
      console.error(`Failed to update the request: ${err}`);
      throw err;
    }
  }

  async get(id: UUID): Promise<Request> {
    try {
      const collection = await this.getCollection();
      const document = await collection.findOne<RequestDocument>({ id });

      if (!document) {
        throw new Error("No request found with the given ID");
      }

      return this.deserialize(document);
    } catch (err) {
      console.error(`Failed to get the request: ${err}`);
      throw err;
    }
  }

  private async getCollection(): Promise<Collection<RequestDocument>> {
    if (this.collection != null) {
      return this.collection;
    }

    if (this.connectionPromise == null) {
      const client = new MongoClient(this.uri);
      this.connectionPromise = client.connect();
    }

    const client = await this.connectionPromise;
    const collection = client
      .db(this.dbName)
      .collection<RequestDocument>(this.collectionName);
    this.collection = collection;
    return collection;
  }

  // Serialization, TODO use ZOD here

  private serializeRequest(request: Request): RequestDocument {
    const { id, status, to, from, chainId, value, nonce, fees, hash, data } =
      request;
    return {
      id,
      status,
      to,
      from,
      chainId,
      value: value.toString(), // convert bigint to string
      nonce,
      fees: this.serializeGasFees(fees),
      hash,
      data,
    };
  }

  private deserialize(document: RequestDocument): Request {
    const { id, status, to, from, chainId, value, nonce, fees, hash, data } =
      document;
    return {
      id,
      status,
      to,
      from,
      chainId,
      value: BigInt(value),
      nonce,
      fees: this.deserializeGasFees(fees),
      hash: hash as Hash,
      data: data as Hex,
    };
  }

  private serializeGasFees(gasFees: GasFees): GasFeesDocument {
    const gasFeesDocument: any = {};

    for (const [key, value] of Object.entries(gasFees)) {
      gasFeesDocument[key] = value.toString();
    }

    return gasFeesDocument;
  }

  private deserializeGasFees(gasFees: GasFeesDocument): GasFees {
    const gasFeesDocument: any = {};

    for (const [key, value] of Object.entries(gasFees)) {
      gasFeesDocument[key] = BigInt(value);
    }

    return gasFeesDocument;
  }
}
