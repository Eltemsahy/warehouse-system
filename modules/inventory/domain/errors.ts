export class InsufficientStockError extends Error {
  constructor(message = "insufficient stock: balance cannot go negative") {
    super(message);
    this.name = "InsufficientStockError";
  }
}