import { AuditLog, SearchHistory, User } from '../modules/models.js';

// A write to the account serializes search recording with preference changes and history deletion.
export async function recordSearch(userId: string, query: string, medicineId?: string): Promise<void> {
  const session = await User.startSession();
  try { await session.withTransaction(async () => {
    const user = await User.findOneAndUpdate({ _id: userId, active: true, 'preferences.recordSearchHistory': { $ne: false } }, { $inc: { searchHistoryRevision: 1 } }, { session });
    if (user) await SearchHistory.create([{ userId, query, ...(medicineId ? { medicineId } : {}) }], { session });
  }); } finally { await session.endSession(); }
}

export async function clearSearchHistory(userId: string): Promise<void> {
  const session = await User.startSession();
  try { await session.withTransaction(async () => {
    await User.updateOne({ _id: userId, active: true }, { $inc: { searchHistoryRevision: 1 } }, { session });
    await SearchHistory.deleteMany({ userId }).session(session);
    await AuditLog.create([{ actorId: userId, action: 'user.search_history.cleared', resourceType: 'User', resourceId: userId }], { session });
  }); } finally { await session.endSession(); }
}
