import { MongoClient, Collection, Document } from "mongodb";
import { RequestRepository } from "./RequestRepository";
import { Hash } from "viem";
import { UUID } from "crypto";
import {
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
    const collection = await this.getCollection();
    await collection.insertOne(request);
  }

  async update(
    id: UUID,
    update: { status?: Status; hash?: Hash; fees?: SerializedGasFees }
  ): Promise<void> {
    const collection = await this.getCollection();
    await collection.findOneAndUpdate(
      { id },
      { $set: update },
      { returnDocument: "after" }
    );
  }

  async find(id: UUID): Promise<SerializedRequest | null> {
    const collection = await this.getCollection();
    const document = await collection.findOne<RequestDocument>({ id });

    if (!document) {
      return null;
    }

    return request.parse(document);
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
