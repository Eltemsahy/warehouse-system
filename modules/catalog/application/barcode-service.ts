import { err, newId, ok, type Result } from "../../../shared/kernel/index.js";
import { NotFoundError, type CatalogError } from "../domain/errors.js";
import {
  BARCODE_MESSAGE,
  BARCODE_PATTERN,
  BARCODE_TYPES,
  type BarcodeType,
  type Item,
} from "../domain/model.js";
import type { CatalogRepository } from "./ports.js";
import { attempt, violation } from "./support.js";

export interface BarcodeView {
  barcode: string;
  type: BarcodeType;
  /** Code of the unit this barcode identifies, for example "CS". */
  uom: string;
  /** How many base units one scan stands for. */
  qtyInBase: number;
}

/** What scanning a barcode tells you. */
export interface ScannedBarcode extends BarcodeView {
  item: Item;
}

export interface AddBarcodeInput {
  barcode: string;
  uom: string;
  type?: BarcodeType;
}

export class BarcodeService {
  constructor(private repo: CatalogRepository) {}

  async add(sku: string, i: AddBarcodeInput): Promise<Result<BarcodeView, CatalogError>> {
    if (!BARCODE_PATTERN.test(i.barcode)) return violation(`barcode ${BARCODE_MESSAGE}`);
    const type = i.type ?? "OTHER";
    if (!BARCODE_TYPES.includes(type)) return violation(`unknown barcode type "${type}"`);

    const item = await this.repo.getItemBySku(sku);
    if (!item) return err(new NotFoundError("item"));
    const units = await this.repo.listItemUoms(item.id);
    const unit = units.find((u) => u.uom.code.toLowerCase() === i.uom.toLowerCase());
    if (!unit) return violation(`the item has no unit "${i.uom}"; add the unit first`);

    const added = await attempt(() =>
      this.repo.addBarcode({
        id: newId(),
        itemId: item.id,
        itemUomId: unit.id,
        barcode: i.barcode,
        type,
        createdAt: new Date(),
        createdBy: null,
      }),
    );
    return added.ok
      ? ok({
          barcode: added.value.barcode,
          type: added.value.type,
          uom: unit.uom.code,
          qtyInBase: unit.qtyInBase,
        })
      : added;
  }

  async list(sku: string): Promise<Result<BarcodeView[], CatalogError>> {
    const item = await this.repo.getItemBySku(sku);
    if (!item) return err(new NotFoundError("item"));
    const [barcodes, units] = await Promise.all([
      this.repo.listBarcodes(item.id),
      this.repo.listItemUoms(item.id),
    ]);
    const unitById = new Map(units.map((u) => [u.id, u]));
    return ok(
      barcodes.flatMap((b) => {
        const unit = unitById.get(b.itemUomId);
        return unit
          ? [{ barcode: b.barcode, type: b.type, uom: unit.uom.code, qtyInBase: unit.qtyInBase }]
          : [];
      }),
    );
  }

  async remove(sku: string, barcode: string): Promise<Result<void, CatalogError>> {
    const item = await this.repo.getItemBySku(sku);
    if (!item) return err(new NotFoundError("item"));
    const found = (await this.repo.listBarcodes(item.id)).find((b) => b.barcode === barcode);
    if (!found) return err(new NotFoundError("barcode"));
    return attempt(() => this.repo.deleteBarcode(found.id));
  }

  /** Exact, case-sensitive. An inactive item still resolves; the caller sees its status. */
  async resolve(barcode: string): Promise<Result<ScannedBarcode, CatalogError>> {
    const found = await this.repo.resolveBarcode(barcode);
    if (!found) return err(new NotFoundError("barcode"));
    return ok({
      barcode: found.barcode.barcode,
      type: found.barcode.type,
      uom: found.itemUom.uom.code,
      qtyInBase: found.itemUom.qtyInBase,
      item: found.item,
    });
  }
}
