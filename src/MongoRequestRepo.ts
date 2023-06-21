import { MongoClient, Collection, Document } from "mongodb";
import { RequestRepository } from "./RequestRepository";
import { Hash } from "viem";
import { UUID } from "crypto";
import {
  Request,
  SerializedGasFees,
  SerializedRequest,
  Status,
  request,
} from "./TypesAndValidation";

type RequestDocument = SerializedRequest & Document;

export class MongoRequestRepository implements RequestRepository {
  private connectionPromise: Promise<MongoClient> | null = null;
  private collection: Collection<RequestDocument> | null = null;
  private uri: string;
  private dbName = "TreasuryService";
  private collectionName = "requests";

  constructor(uri: string) {
    this.uri = uri;
  }

  public async create(request: SerializedRequest): Promise<void> {
    try {
      const collection = await this.getCollection();
      await collection.insertOne(request);
    } catch (err) {
      console.error(`Failed to create a new request: ${err}`);
      throw err;
    }
  }

  async update(
    id: UUID,
    status: Status,
    hash: Hash,
    fees: SerializedGasFees
  ): Promise<void> {
    try {
      const collection = await this.getCollection();
      await collection.findOneAndUpdate(
        { id },
        { $set: { status, hash, fees } },
        { returnDocument: "after" }
      );
    } catch (err) {
      console.error(`Failed to update the request: ${err}`);
      throw err;
    }
  }

  async get(id: UUID): Promise<SerializedRequest> {
    try {
      const collection = await this.getCollection();
      const document = await collection.findOne<RequestDocument>({ id });

      if (!document) {
        throw new Error("No request found with the given ID");
      }

      return request.parse(document);
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
}
