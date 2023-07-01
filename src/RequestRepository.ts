import { MongoClient, Collection } from "mongodb";
import { Hash } from "viem";
import { UUID } from "crypto";
import {
  GasFees,
  Status,
  request,
  Request,
  serializeWithBigInt,
} from "./TypesAndValidation";

export interface RequestRepository {
  create(request: Request): Promise<void>;
  update(
    id: UUID,
    update: {
      status?: Status;
      hash?: Hash;
      fees?: GasFees;
    }
  ): Promise<void>;
  find(id: UUID): Promise<Request | null>;
}

export class MongoRequestRepository implements RequestRepository {
  private connectionPromise: Promise<MongoClient> | null = null;
  private collection: Collection | null = null;
  private uri: string;
  private dbName = "TreasuryService";
  private collectionName = "requests";

  constructor(uri: string) {
    this.uri = uri;
  }

  public async create(request: Request): Promise<void> {
    const collection = await this.getCollection();
    await collection.insertOne(serializeWithBigInt(request));
  }

  async update(
    id: UUID,
    update: { status?: Status; hash?: Hash; fees?: GasFees }
  ): Promise<void> {
    const collection = await this.getCollection();

    await collection.findOneAndUpdate(
      { id },
      { $set: serializeWithBigInt(update) }
    );
  }

  async find(id: UUID): Promise<Request | null> {
    const collection = await this.getCollection();
    const document = await collection.findOne({ id });

    if (!document) {
      return null;
    }

    return request.parse(document);
  }

  private async getCollection(): Promise<Collection> {
    if (this.collection != null) {
      return this.collection;
    }

    if (this.connectionPromise == null) {
      const client = new MongoClient(this.uri);
      this.connectionPromise = client.connect();
    }

    const client = await this.connectionPromise;
    const collection = client.db(this.dbName).collection(this.collectionName);
    this.collection = collection;
    return collection;
  }
}
