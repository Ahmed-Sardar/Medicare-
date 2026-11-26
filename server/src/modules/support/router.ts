import { lockActiveAccount } from '../../services/activeAccount.js';
import { Router } from 'express';
import mongoose, { type ClientSession } from 'mongoose';
import { sharedAccountLimit } from '../../services/sharedRateLimit.js';
import { z } from 'zod';
import { AuditLog, Notification, Pharmacy, PharmacyStaff, SupportFanout, SupportTicket, User } from '../models.js';
import { authenticate } from '../../middleware/auth.js';
import { hasPermission, requirePermission } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/errors.js';
import { roleCodesWithPermission } from '../../services/rbac.js';
import { env } from '../../config/env.js';

export const supportRouter = Router();
supportRouter.use(authenticate);
const ticketLimiter = sharedAccountLimit('support-ticket', 15);
const commentLimiter = sharedAccountLimit('support-comment', 60);
const idSchema = z.string().regex(/^[0-9a-f]{24}$/i);
const statusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED']);
const prioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH']);
const categorySchema = z.enum(['ACCOUNT', 'PHARMACY', 'RESERVATION', 'INVENTORY', 'OTHER']);

const canManage = (permissions: string[]) => hasPermission(permissions, 'support:manage');
const revisionFilter = (revision: number): Record<string, unknown> => revision === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision };
const validTransitions: Record<string, string[]> = { OPEN: ['IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'], IN_PROGRESS: ['OPEN', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'], WAITING_FOR_USER: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'], RESOLVED: ['OPEN', 'CLOSED'], CLOSED: ['OPEN'] };
type SupportRecipients = string[] | { all: true; excludeUserId: string };
async function supportRecipients(assignedTo: string | undefined, actorId: string, session: ClientSession): Promise<SupportRecipients> {
  const supportRoles = await roleCodesWithPermission('support:manage', session);
  if (assignedTo === actorId) assignedTo = undefined;
  if (assignedTo && await User.exists({ _id: assignedTo, active: true, roles: { $in: supportRoles } }).session(session)) return [assignedTo];
  return { all: true, excludeUserId: actorId };
}
async function notify(recipients: SupportRecipients, type: string, title: string, ticketId: string, session: ClientSession, view: 'mine' | 'inbox'): Promise<void> {
  if (!Array.isArray(recipients)) { await SupportFanout.create([{ ticketId, excludeUserId: recipients.excludeUserId, type, title, purgeAt: new Date(Date.now() + 30 * 86400000) }], { session }); return; }
  const unique = [...new Set(recipients)]; if (!unique.length) return;
  await Notification.create(unique.map((userId) => ({ userId, type, title, message: 'Open your support workspace to view the update.', data: { ticketId, view } })), { session });
}
function populatedTicket(id: string) { return SupportTicket.findById(id).populate('requesterId', 'name').populate('assignedTo', 'name').populate('pharmacyId', 'name city').populate('comments.authorId', 'name').populate('statusHistory.actorId', 'name'); }

supportRouter.get('/agents', requirePermission('support:manage'), asyncHandler(async (_req, res) => {
  const supportRoles = await roleCodesWithPermission('support:manage');
  const agents = await User.find({ active: true, roles: { $in: supportRoles } }).select('name email').sort({ name: 1, _id: 1 });
  res.json({ success: true, data: { agents } });
}));

supportRouter.get('/', asyncHandler(async (req, res) => {
  const input = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(50).default(20), scope: z.enum(['mine', 'all']).optional(), status: statusSchema.optional(), priority: prioritySchema.optional(), category: categorySchema.optional(), assignedTo: z.union([idSchema, z.literal('unassigned'), z.literal('me')]).optional() }).parse(req.query);
  const manager = canManage(req.auth!.permissions); if (!manager && input.assignedTo) throw new ApiError(403, 'Support assignment filters require support access');
  if (!manager && input.scope === 'all') throw new ApiError(403, 'Support management permission required');
  const filter: Record<string, unknown> = !manager || input.scope === 'mine' ? { requesterId: req.auth!.id } : {};
  if (input.status) filter.status = input.status; if (input.priority) filter.priority = input.priority; if (input.category) filter.category = input.category;
  if (input.assignedTo) filter.assignedTo = input.assignedTo === 'unassigned' ? null : input.assignedTo === 'me' ? req.auth!.id : input.assignedTo;
  const [tickets, total] = await Promise.all([SupportTicket.find(filter).select('-comments -statusHistory -resolutionNotes').sort({ updatedAt: -1, _id: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).populate('requesterId', 'name').populate('assignedTo', 'name').populate('pharmacyId', 'name city'), SupportTicket.countDocuments(filter)]);
  res.json({ success: true, data: { tickets, page: input.page, limit: input.limit, total } });
}));

supportRouter.post('/', ticketLimiter, asyncHandler(async (req, res) => {
  const input = z.object({ subject: z.string().trim().min(5).max(160), category: categorySchema, priority: prioritySchema.default('NORMAL'), pharmacyId: idSchema.optional(), body: z.string().trim().min(5).max(3000) }).parse(req.body);
  if (input.pharmacyId) {
    const assigned = await PharmacyStaff.exists({ pharmacyId: input.pharmacyId, userId: req.auth!.id, active: true });
    const publiclyVisible = await Pharmacy.exists({ _id: input.pharmacyId, verificationStatus: 'APPROVED', active: true, ...(env.ALLOW_DEMO_DISCOVERY ? {} : { isDemo: { $ne: true } }) });
    if (!assigned && !publiclyVisible && !canManage(req.auth!.permissions)) throw new ApiError(404, 'Pharmacy not found');
    if (canManage(req.auth!.permissions) && !assigned && !publiclyVisible && !await Pharmacy.exists({ _id: input.pharmacyId })) throw new ApiError(404, 'Pharmacy not found');
  }
  const session = await mongoose.startSession(); let ticketId = '';
  try { await session.withTransaction(async () => {
      await lockActiveAccount(req.auth!.id, session);
    const [ticket] = await SupportTicket.create([{ requesterId: req.auth!.id, pharmacyId: input.pharmacyId, subject: input.subject, category: input.category, priority: input.priority, status: 'OPEN', revision: 0, comments: [{ authorId: req.auth!.id, body: input.body, at: new Date() }], statusHistory: [{ status: 'OPEN', actorId: req.auth!.id, at: new Date() }] }], { session });
    ticketId = ticket!.id;
    await AuditLog.create([{ actorId: req.auth!.id, action: 'support.ticket.created', resourceType: 'SupportTicket', resourceId: ticketId, ipAddress: req.ip }], { session });
    await notify(await supportRecipients(undefined, req.auth!.id, session), 'SUPPORT_TICKET_CREATED', 'New support ticket', ticketId, session, 'inbox');
  }); } finally { await session.endSession(); }
  res.status(201).json({ success: true, data: { ticket: await populatedTicket(ticketId) } });
}));

supportRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id); const ticket = await SupportTicket.findOne({ _id: id, ...(canManage(req.auth!.permissions) ? {} : { requesterId: req.auth!.id }) }).select('_id');
  if (!ticket) throw new ApiError(404, 'Ticket not found');
  res.json({ success: true, data: { ticket: await populatedTicket(id) } });
}));

supportRouter.post('/:id/comments', commentLimiter, asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id); const { body } = z.object({ body: z.string().trim().min(1).max(3000) }).parse(req.body);
  const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
      await lockActiveAccount(req.auth!.id, session);
    const ticket = await SupportTicket.findById(id).session(session); if (!ticket) throw new ApiError(404, 'Ticket not found');
    const owner = String(ticket.requesterId) === req.auth!.id; const manager = canManage(req.auth!.permissions);
    if (!owner && !manager) throw new ApiError(404, 'Ticket not found');
    if (ticket.comments.length >= 500) throw new ApiError(409, 'This conversation has reached its message limit; create a new ticket');
    if (ticket.contentPurgedAt) throw new ApiError(409, 'This conversation was retired under retention policy; create a new ticket');
    if (!owner && ['RESOLVED', 'CLOSED'].includes(ticket.status)) throw new ApiError(409, 'Reopen the ticket before replying');
    const nextStatus = owner && ['RESOLVED', 'CLOSED', 'WAITING_FOR_USER'].includes(ticket.status) ? 'OPEN' : !owner && ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status;
    const push: Record<string, unknown> = { comments: { authorId: req.auth!.id, body, at: new Date() } };
    const reopening = owner && ['RESOLVED', 'CLOSED'].includes(ticket.status);
    if (nextStatus !== ticket.status) push.statusHistory = { status: nextStatus, actorId: req.auth!.id, ...(reopening && ticket.resolutionNotes ? { resolutionNotes: ticket.resolutionNotes } : {}), at: new Date() };
    const result = await SupportTicket.updateOne({ _id: id, status: ticket.status, ...revisionFilter(ticket.revision ?? 0) }, { $push: push as never, $set: { status: nextStatus }, $inc: { revision: 1 }, ...(reopening ? { $unset: { resolutionNotes: 1 } } : {}) }, { session });
    if (!result.matchedCount) throw new ApiError(409, 'Ticket changed; reload and try again');
    await AuditLog.create([{ actorId: req.auth!.id, action: 'support.comment.created', resourceType: 'SupportTicket', resourceId: id, ipAddress: req.ip }], { session });
    const recipients = owner ? await supportRecipients(ticket.assignedTo ? String(ticket.assignedTo) : undefined, req.auth!.id, session) : [String(ticket.requesterId)];
    await notify(recipients, 'SUPPORT_COMMENT', 'Support conversation updated', id, session, owner ? 'inbox' : 'mine');
  }); } finally { await session.endSession(); }
  res.status(201).json({ success: true, data: { ticket: await populatedTicket(id) } });
}));

supportRouter.patch('/:id/status', requirePermission('support:manage'), asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const input = z.object({ revision: z.number().int().min(0), status: statusSchema.optional(), priority: prioritySchema.optional(), resolutionNotes: z.string().trim().max(2000).optional(), assignedTo: z.union([idSchema, z.null()]).optional() }).refine((value) => value.status !== undefined || value.priority !== undefined || value.resolutionNotes !== undefined || value.assignedTo !== undefined, 'At least one change is required').parse(req.body);
  const session = await mongoose.startSession();
  try { await session.withTransaction(async () => {
      await lockActiveAccount(req.auth!.id, session);
    const ticket = await SupportTicket.findOne({ _id: id, ...revisionFilter(input.revision) }).session(session); if (!ticket) throw new ApiError(409, 'Ticket changed or no longer exists; reload before saving');
    if (ticket.contentPurgedAt) throw new ApiError(409, 'This conversation was retired under retention policy; create a new ticket');
    const nextStatus = input.status ?? ticket.status;
    if (nextStatus !== ticket.status && !validTransitions[ticket.status]?.includes(nextStatus)) throw new ApiError(409, `Cannot change ticket from ${ticket.status} to ${nextStatus}`);
    const reopening = ['RESOLVED', 'CLOSED'].includes(ticket.status) && nextStatus === 'OPEN';
    const resolutionNotes = reopening ? '' : input.resolutionNotes ?? ticket.resolutionNotes ?? '';
    if (['RESOLVED', 'CLOSED'].includes(nextStatus) && !resolutionNotes.trim()) throw new ApiError(400, 'Resolution notes are required to resolve or close a ticket');
    const supportRoles = await roleCodesWithPermission('support:manage', session);
    if (input.assignedTo && !await User.exists({ _id: input.assignedTo, active: true, roles: { $in: supportRoles } }).session(session)) throw new ApiError(400, 'Assignee must be an active support agent');
    const set: Record<string, unknown> = {}; const unset: Record<string, number> = {};
    if (input.status !== undefined) set.status = input.status; if (input.priority !== undefined) set.priority = input.priority; if (reopening) unset.resolutionNotes = 1; else if (input.resolutionNotes !== undefined) set.resolutionNotes = input.resolutionNotes;
    if (input.assignedTo === null) unset.assignedTo = 1; else if (input.assignedTo !== undefined) set.assignedTo = input.assignedTo;
    const update: Record<string, unknown> = { $set: set, $inc: { revision: 1 } }; if (Object.keys(unset).length) update.$unset = unset;
    if (nextStatus !== ticket.status || (input.resolutionNotes !== undefined && input.resolutionNotes !== (ticket.resolutionNotes ?? ''))) update.$push = { statusHistory: { status: nextStatus, actorId: req.auth!.id, ...(reopening && ticket.resolutionNotes ? { resolutionNotes: ticket.resolutionNotes } : input.resolutionNotes !== undefined || ['RESOLVED', 'CLOSED'].includes(nextStatus) ? { resolutionNotes } : {}), at: new Date() } };
    const changed = await SupportTicket.updateOne({ _id: id, ...revisionFilter(input.revision) }, update as never, { runValidators: true, session }); if (!changed.matchedCount) throw new ApiError(409, 'Ticket changed; reload before saving');
    await AuditLog.create([{ actorId: req.auth!.id, action: 'support.ticket.updated', resourceType: 'SupportTicket', resourceId: id, metadata: { fields: Object.keys(input).filter((key) => key !== 'revision'), previousStatus: ticket.status, status: nextStatus, previousPriority: ticket.priority, priority: input.priority ?? ticket.priority, previousAssignee: ticket.assignedTo ? String(ticket.assignedTo) : null, assignee: input.assignedTo === undefined ? (ticket.assignedTo ? String(ticket.assignedTo) : null) : input.assignedTo }, ipAddress: req.ip }], { session });
    if (String(ticket.requesterId) !== req.auth!.id) await notify([String(ticket.requesterId)], 'SUPPORT_TICKET_UPDATED', 'Support ticket updated', id, session, 'mine');
    if (input.assignedTo && input.assignedTo !== String(ticket.assignedTo) && input.assignedTo !== req.auth!.id) await notify([input.assignedTo], 'SUPPORT_ASSIGNED', 'Support ticket assigned', id, session, 'inbox');
  }); } finally { await session.endSession(); }
  res.json({ success: true, data: { ticket: await populatedTicket(id) } });
}));
