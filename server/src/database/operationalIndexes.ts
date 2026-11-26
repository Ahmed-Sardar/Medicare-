import { EmailDelivery, JobLease, Notification, PhoneChallenge, PrivacyRequest, RateBucket, SupportFanout } from '../modules/models.js';
import { env } from '../config/env.js';
export async function ensureOperationalIndexes(): Promise<void> {
  await Promise.all([EmailDelivery.init(), JobLease.init(), PhoneChallenge.init(), PrivacyRequest.init(), RateBucket.init(), SupportFanout.init(), Notification.init()]);
  if (env.NODE_ENV !== 'production') return;
  for (const [collection, field] of [[EmailDelivery.collection, 'purgeAt'], [PhoneChallenge.collection, 'expiresAt'], [RateBucket.collection, 'expiresAt'], [SupportFanout.collection, 'purgeAt']] as const) {
    const indexes = await collection.indexes();
    if (!indexes.some((index) => index.expireAfterSeconds === 0 && Object.keys(index.key).length === 1 && index.key[field] === 1)) throw new Error(`Provision the ${field} TTL index on ${collection.name} before starting the API`);
  }
  const indexes = await Notification.collection.indexes();
  if (!indexes.some((index) => index.unique && index.sparse && Object.keys(index.key).length === 1 && index.key.dedupKey === 1)) throw new Error('Provision the unique sparse Notification.dedupKey index before starting the API');
}
