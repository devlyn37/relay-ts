import { TransactionManager } from "./TransactionManager";
import { RequestRepository } from "./RequestRepository";

export class RequestMediator {
  private transactionManager: TransactionManager; // TODO add many for many different chains
  private requestRepo: RequestRepository;
  // logger
  // tracing
  // etc...

  constructor(
    transactionManager: TransactionManager,
    requestRepo: RequestRepository
  ) {
    this.transactionManager = transactionManager;
    this.requestRepo = requestRepo;
  }

  public start() {
    return "hi";
  }

  public status() {
    return "hi";
  }
}
