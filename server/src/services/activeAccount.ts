import type { ClientSession } from 'mongoose';
import { User } from '../modules/models.js';
import { ApiError } from '../utils/errors.js';
// Serialize new account-scoped business writes with access revocation and privacy erasure.
export async function lockActiveAccount(userId: string, session: ClientSession): Promise<void> {
  const result = await User.updateOne({ _id: userId, active: true, deletedAt: { $exists: false } }, { $inc: { searchHistoryRevision: 1 } }, { session });
  if (!result.matchedCount) throw new ApiError(401, 'Account is unavailable');
}
