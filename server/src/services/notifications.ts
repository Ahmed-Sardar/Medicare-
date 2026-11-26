import { Notification } from '../modules/models.js';
export async function notifyUser(input: { userId: string; type: string; title: string; message: string; data?: Record<string, unknown> }): Promise<void> {
  await Notification.create(input);
}
