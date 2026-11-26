import type { ClientSession } from 'mongoose';
import { Medicine } from '../modules/models.js';
import { revisionFilter } from '../modules/medicines/contracts.js';
import { ApiError } from '../utils/errors.js';

// Serializes the first inventory reference with catalogue editing and checks the selected revision.
export async function lockMedicineIdentity(medicineId: string, revision: number, session: ClientSession): Promise<void> {
  const medicine = await Medicine.findOneAndUpdate({ _id: medicineId, active: true, ...revisionFilter(revision) }, { $set: { identityLocked: true } }, { session, new: true });
  if (!medicine) throw new ApiError(409, 'The selected catalogue medicine changed or became inactive; select it again or upload a new preview', 'CATALOGUE_CHANGED');
}
