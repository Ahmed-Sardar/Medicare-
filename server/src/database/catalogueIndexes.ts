import { MedicineCategory } from '../modules/models.js';
import { env } from '../config/env.js';
export async function ensureCatalogueIndexes(): Promise<void> {
  await MedicineCategory.init();
  if (env.NODE_ENV !== 'production') return;
  const indexes = await MedicineCategory.collection.indexes();
  if (!indexes.some((index) => index.unique && !index.sparse && !index.partialFilterExpression && Object.keys(index.key).length === 1 && index.key.normalizedName === 1)) throw new Error('Provision the unique MedicineCategory.normalizedName index before starting the API');
}
