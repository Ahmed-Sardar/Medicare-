import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const opts = { timestamps: true, versionKey: false } as const;
const point = { type: { type: String, enum: ['Point'], default: 'Point' }, coordinates: { type: [Number], required: true } };
const savedLocationPointSchema = new Schema(point, { _id: false });

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 }, email: { type: String, lowercase: true, trim: true },
  phone: { type: String, trim: true }, passwordHash: { type: String, required: true, select: false },
  phoneVerifiedAt: Date, phoneVerifiedFor: { type: String, select: false },
  roles: { type: [String], enum: ['SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN', 'CUSTOMER', 'PHARMACY_OWNER', 'PHARMACIST', 'PHARMACY_STAFF'], default: ['CUSTOMER'] },
  active: { type: Boolean, default: true }, authVersion: { type: Number, default: 0 }, emailVerifiedAt: Date, refreshTokenHash: { type: String, select: false }, refreshTokenExpiresAt: Date,
  passwordResetHash: { type: String, select: false }, passwordResetExpiresAt: Date, emailVerificationHash: { type: String, select: false }, emailVerificationExpiresAt: Date,
  savedLocations: [{ label: { type: String, trim: true, maxlength: 60 }, pinCode: String, location: { type: savedLocationPointSchema, required: false }, isDefault: { type: Boolean, default: false } }],
  preferences: { searchRadiusKm: { type: Number, default: 10, min: 1, max: 50 }, searchView: { type: String, enum: ['list', 'map'], default: 'list' }, recordSearchHistory: { type: Boolean, default: true } },
  settingsRevision: { type: Number, default: 0, min: 0 }, searchHistoryRevision: { type: Number, default: 0 },
  accessRevision: { type: Number, default: 0, min: 0 },
  deletedAt: Date,
  isDemo: { type: Boolean, default: false },
}, opts);
userSchema.index({ email: 1 }, { unique: true, sparse: true }); userSchema.index({ phone: 1 }, { unique: true, sparse: true }); userSchema.index({ createdAt: -1 });

const pharmacySchema = new Schema({
  name: { type: String, required: true, trim: true }, ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  address: { type: String, required: true }, pinCode: { type: String, required: true, index: true }, city: { type: String, required: true }, state: { type: String, required: true },
  location: { type: savedLocationPointSchema, required: true }, phone: String, email: String, openingHours: [{ day: Number, open: String, close: String, closed: Boolean }],
  holidayHours: [{ date: String, label: String, open: String, close: String, closed: Boolean }], quantityDisplay: { type: String, enum: ['EXACT', 'RANGE'], default: 'RANGE' }, quantityCap: { type: Number, default: 10, min: 1, max: 1000 },
  verificationStatus: { type: String, enum: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'], default: 'DRAFT', index: true },
  active: { type: Boolean, default: true }, licenseNumber: String, licenseDocumentPath: { type: String, select: false }, licenseDocumentOriginalName: String, registeredPharmacistName: String,
  verificationHistory: [{ status: String, reason: String, actorId: Schema.Types.ObjectId, at: { type: Date, default: Date.now } }], isDemo: { type: Boolean, default: false },
  revision: { type: Number, default: 0, min: 0 },
}, opts);
pharmacySchema.index({ location: '2dsphere' }); pharmacySchema.index({ createdAt: -1 });

const staffSchema = new Schema({ pharmacyId: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true, index: true }, userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, role: { type: String, enum: ['PHARMACY_OWNER', 'PHARMACIST', 'PHARMACY_STAFF'], required: true }, permissions: { type: [String], default: [] }, active: { type: Boolean, default: true }, invitedBy: Schema.Types.ObjectId, isDemo: { type: Boolean, default: false } }, opts);
staffSchema.index({ pharmacyId: 1, userId: 1 }, { unique: true });

const categorySchema = new Schema({ name: { type: String, required: true, trim: true, maxlength: 100 }, normalizedName: { type: String, required: true, unique: true }, description: { type: String, default: '', maxlength: 500 }, active: { type: Boolean, default: true }, revision: { type: Number, default: 0, min: 0 }, updatedBy: Schema.Types.ObjectId }, opts);
categorySchema.index({ active: 1, name: 1 });
const medicineSchema = new Schema({
  name: { type: String, required: true, maxlength: 160 }, brand: { type: String, maxlength: 160 }, genericName: { type: String, maxlength: 200 }, composition: { type: String, maxlength: 500 },
  strength: { type: String, required: true, maxlength: 100 }, dosageForm: { type: String, required: true, maxlength: 100 }, manufacturer: { type: String, maxlength: 200 }, packSize: { type: String, maxlength: 100 }, aliases: [String],
  categoryIds: [{ type: Schema.Types.ObjectId, ref: 'MedicineCategory' }],
  prescriptionClass: { type: String, enum: ['OTC', 'PRESCRIPTION', 'CONTROLLED', 'UNVERIFIED'], default: 'UNVERIFIED' },
  classificationVerified: { type: Boolean, default: false }, classificationSource: { type: String, maxlength: 500 }, classificationReviewedAt: Date, classificationReviewedBy: Schema.Types.ObjectId,
  identityLocked: { type: Boolean, default: false }, revision: { type: Number, default: 0, min: 0 }, updatedBy: Schema.Types.ObjectId,
  active: { type: Boolean, default: true }, isDemo: { type: Boolean, default: false },
}, opts);
medicineSchema.index({ name: 'text', brand: 'text', genericName: 'text', composition: 'text', manufacturer: 'text', aliases: 'text' });
medicineSchema.index({ active: 1, name: 1, _id: 1 }); medicineSchema.index({ categoryIds: 1, active: 1 });

const inventorySchema = new Schema({ pharmacyId: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true }, medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true }, active: { type: Boolean, default: true }, minStock: { type: Number, default: 0 }, reorderThreshold: { type: Number, min: 0 }, alertsEnabled: { type: Boolean, default: true }, stockStatus: { type: String, enum: ['AVAILABLE', 'UNAVAILABLE'], default: 'AVAILABLE' }, verificationStatus: { type: String, enum: ['UNVERIFIED', 'VERIFIED'], default: 'UNVERIFIED' }, lastUpdatedAt: { type: Date, default: Date.now }, lastVerifiedAt: Date, lastUpdatedBy: Schema.Types.ObjectId, isDemo: { type: Boolean, default: false } }, opts);
inventorySchema.index({ pharmacyId: 1, medicineId: 1 }, { unique: true });
inventorySchema.index({ pharmacyId: 1, active: 1, updatedAt: -1, _id: -1 });


const batchSchema = new Schema({ inventoryId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true, index: true }, batchNumber: { type: String, required: true }, expiryDate: { type: Date, required: true, index: true }, onHandQuantity: { type: Number, min: 0, required: true }, reservedQuantity: { type: Number, min: 0, default: 0 }, sellingPrice: { type: Number, min: 0, required: true }, mrp: { type: Number, min: 0, required: true }, manufacturer: String, active: { type: Boolean, default: true }, isDemo: { type: Boolean, default: false } }, opts);
batchSchema.index({ inventoryId: 1, expiryDate: 1 });
batchSchema.index({ inventoryId: 1, batchNumber: 1 }, { unique: true });

const movementSchema = new Schema({ pharmacyId: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true, index: true }, inventoryId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true }, batchId: Schema.Types.ObjectId, actorId: Schema.Types.ObjectId, type: { type: String, enum: ['INITIAL_STOCK', 'STOCK_ADDITION', 'STOCK_REDUCTION', 'RESERVATION_HOLD', 'RESERVATION_RELEASE', 'COLLECTION', 'STOCK_CORRECTION', 'EXPIRED_STOCK', 'RETURN'], required: true }, quantity: { type: Number, required: true }, referenceId: Schema.Types.ObjectId, note: String, isDemo: { type: Boolean, default: false } }, opts);
movementSchema.index({ pharmacyId: 1, createdAt: -1 });

const reservationSchema = new Schema({ customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, pharmacyId: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true, index: true }, medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true }, quantity: { type: Number, required: true, min: 1 }, allocatedBatches: [{ batchId: Schema.Types.ObjectId, quantity: Number }], status: { type: String, enum: ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'COLLECTED', 'REJECTED', 'CANCELLED', 'EXPIRED'], default: 'PENDING', index: true }, holdExpiresAt: Date, pickupExpiresAt: Date, notes: { type: String, maxlength: 500 }, history: [{ status: String, actorId: Schema.Types.ObjectId, note: String, reviewAttestation: { stockReviewed: Boolean, prescriptionRequirementsReviewed: Boolean }, at: { type: Date, default: Date.now } }], collectedAt: Date, idempotencyKey: String, isDemo: { type: Boolean, default: false } }, opts);
reservationSchema.index({ customerId: 1, idempotencyKey: 1 }, { name: 'unique_customer_idempotency_key', unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }); reservationSchema.index({ status: 1, holdExpiresAt: 1 }); reservationSchema.index({ pharmacyId: 1, createdAt: -1 }); reservationSchema.index({ medicineId: 1, createdAt: -1 }); reservationSchema.index({ createdAt: -1 });

const notificationSchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, type: { type: String, required: true }, title: { type: String, required: true }, message: { type: String, required: true }, data: Schema.Types.Mixed, dedupKey: { type: String, unique: true, sparse: true }, readAt: Date, isDemo: { type: Boolean, default: false } }, opts);
const auditSchema = new Schema({ actorId: Schema.Types.ObjectId, action: { type: String, required: true }, resourceType: String, resourceId: Schema.Types.ObjectId, pharmacyId: Schema.Types.ObjectId, metadata: Schema.Types.Mixed, ipAddress: String }, opts);
auditSchema.index({ createdAt: -1 }); auditSchema.index({ pharmacyId: 1, createdAt: -1 });
auditSchema.index({ createdAt: -1, _id: -1 }); auditSchema.index({ actorId: 1, createdAt: -1, _id: -1 }); auditSchema.index({ action: 1, createdAt: -1, _id: -1 }); auditSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1, _id: -1 });
auditSchema.index({ pharmacyId: 1, createdAt: -1, _id: -1 }); auditSchema.index({ resourceId: 1, createdAt: -1, _id: -1 });
const pharmacistSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true }, registrationNumber: String, council: String,
  verificationStatus: { type: String, enum: ['PENDING', 'VERIFIED', 'REJECTED'], default: 'PENDING' },
  pharmacyIds: [{ type: Schema.Types.ObjectId, ref: 'Pharmacy' }], revision: { type: Number, default: 0 },
  evidenceDocumentPath: { type: String, select: false }, evidenceOriginalName: String, evidenceUploadedAt: Date,
  reviewReason: String, reviewedAt: Date, reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  verificationHistory: [{ status: String, action: String, actorId: Schema.Types.ObjectId, reason: String, at: { type: Date, default: Date.now } }],
  isDemo: { type: Boolean, default: false },
}, opts);
const ticketSchema = new Schema({
  requesterId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, pharmacyId: { type: Schema.Types.ObjectId, ref: 'Pharmacy' },
  subject: { type: String, required: true }, category: { type: String, enum: ['ACCOUNT', 'PHARMACY', 'RESERVATION', 'INVENTORY', 'OTHER'], required: true },
  priority: { type: String, enum: ['LOW', 'NORMAL', 'HIGH'], default: 'NORMAL' }, status: { type: String, enum: ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'], default: 'OPEN' },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' }, revision: { type: Number, default: 0 },
  comments: [{ authorId: { type: Schema.Types.ObjectId, ref: 'User' }, body: String, at: { type: Date, default: Date.now } }], resolutionNotes: String,
  statusHistory: [{ status: String, actorId: { type: Schema.Types.ObjectId, ref: 'User' }, resolutionNotes: String, at: { type: Date, default: Date.now } }],
  retentionHold: { type: Boolean, default: false }, contentPurgedAt: Date,
}, opts);
ticketSchema.index({ requesterId: 1, updatedAt: -1 }); ticketSchema.index({ status: 1, updatedAt: -1 }); ticketSchema.index({ assignedTo: 1, status: 1, updatedAt: -1 });
const searchHistorySchema = new Schema({ userId: Schema.Types.ObjectId, query: String, medicineId: Schema.Types.ObjectId, createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 365 } });
searchHistorySchema.index({ userId: 1, createdAt: -1 });
const savedPharmacySchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, pharmacyId: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true } }, opts);
savedPharmacySchema.index({ userId: 1, pharmacyId: 1 }, { unique: true });
const settingSchema = new Schema({ key: { type: String, required: true, unique: true }, value: { type: Schema.Types.Mixed, required: true }, updatedBy: Schema.Types.ObjectId }, opts);
const importJobSchema = new Schema({ pharmacyId: { type: Schema.Types.ObjectId, ref: 'Pharmacy', required: true, index: true }, actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, status: { type: String, enum: ['PREVIEW', 'COMMITTED', 'EXPIRED'], default: 'PREVIEW', index: true }, rows: [{ rowNumber: Number, data: Schema.Types.Mixed, medicineId: Schema.Types.ObjectId }], errors: [{ rowNumber: Number, message: String }], expiresAt: { type: Date, required: true, index: { expires: 0 } } }, opts);

function model<T>(name: string, schema: Schema<T>): mongoose.Model<T> { return (mongoose.models[name] as mongoose.Model<T> | undefined) ?? mongoose.model<T>(name, schema); }
const roleSchema = new Schema({ code: { type: String, required: true, unique: true }, name: { type: String, required: true }, permissions: { type: [String], default: [] }, revision: { type: Number, default: 0, min: 0 }, updatedBy: Schema.Types.ObjectId }, opts);
const permissionSchema = new Schema({ code: { type: String, required: true, unique: true }, allowedRoles: { type: [String], default: [] } }, opts);
export const Role = model('Role', roleSchema); export const Permission = model('Permission', permissionSchema);
export const User = model('User', userSchema); export const Pharmacy = model('Pharmacy', pharmacySchema); export const PharmacyStaff = model('PharmacyStaff', staffSchema);
export const MedicineCategory = model('MedicineCategory', categorySchema);
export const Medicine = model('Medicine', medicineSchema); export const Inventory = model('Inventory', inventorySchema); export const InventoryBatch = model('InventoryBatch', batchSchema);
export const StockMovement = model('StockMovement', movementSchema); export const Reservation = model('Reservation', reservationSchema); export const Notification = model('Notification', notificationSchema);
export const AuditLog = model('AuditLog', auditSchema); export const Pharmacist = model('Pharmacist', pharmacistSchema); export const SupportTicket = model('SupportTicket', ticketSchema); export const SearchHistory = model('SearchHistory', searchHistorySchema);
export const SystemSetting = model('SystemSetting', settingSchema);
export const SavedPharmacy = model('SavedPharmacy', savedPharmacySchema);
export const InventoryImportJob = model('InventoryImportJob', importJobSchema);
const leaseSchema = new Schema({ _id: String, owner: { type: String, required: true }, expiresAt: { type: Date, required: true } }, { versionKey: false });
const rateBucketSchema = new Schema({ _id: String, count: { type: Number, required: true }, expiresAt: { type: Date, required: true } }, { versionKey: false });
rateBucketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const JobLease = model('JobLease', leaseSchema);
export const RateBucket = model('RateBucket', rateBucketSchema);
const deliverySchema = new Schema({ kind: { type: String, enum: ['verify', 'reset'], required: true }, userId: { type: Schema.Types.ObjectId, ref: 'User' }, tokenHash: { type: String, select: false }, payload: { type: String, select: false },
  status: { type: String, enum: ['QUEUED', 'SENDING', 'ACCEPTED', 'FAILED', 'EXPIRED', 'CANCELLED'], default: 'QUEUED' }, attempts: { type: Number, default: 0 }, nextAttemptAt: { type: Date, default: Date.now }, lockToken: String, lockedUntil: Date,
  providerId: String, providerEvent: String, lastError: String, receiptCheckedAt: Date, expiresAt: { type: Date, required: true }, purgeAt: { type: Date, required: true } }, opts);
deliverySchema.index({ status: 1, nextAttemptAt: 1, lockedUntil: 1 }); deliverySchema.index({ userId: 1, createdAt: -1 }); deliverySchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
export const EmailDelivery = model('EmailDelivery', deliverySchema);
const phoneChallengeSchema = new Schema({ _id: String, phone: { type: String, required: true, select: false }, channel: { type: String, enum: ['sms', 'whatsapp'], required: true }, revision: { type: String, required: true }, codeHash: { type: String, select: false }, providerSid: { type: String, select: false }, attempts: { type: Number, default: 0 }, consumed: { type: Boolean, default: false }, expiresAt: { type: Date, required: true } }, opts);
phoneChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const PhoneChallenge = model('PhoneChallenge', phoneChallengeSchema);
const privacyRequestSchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, status: { type: String, enum: ['PENDING', 'HOLD', 'REJECTED', 'CANCELLED', 'COMPLETED'], default: 'PENDING' }, revision: { type: Number, default: 0 }, reason: { type: String, maxlength: 500 }, reviewedBy: Schema.Types.ObjectId, reviewedAt: Date, completedAt: Date }, opts);
privacyRequestSchema.index({ userId: 1, createdAt: -1 }); privacyRequestSchema.index({ status: 1, createdAt: 1 });
export const PrivacyRequest = model('PrivacyRequest', privacyRequestSchema);
const supportFanoutSchema = new Schema({ ticketId: { type: Schema.Types.ObjectId, required: true }, excludeUserId: Schema.Types.ObjectId, afterUserId: Schema.Types.ObjectId, type: { type: String, required: true }, title: { type: String, required: true }, status: { type: String, enum: ['PENDING', 'COMPLETED'], default: 'PENDING' }, purgeAt: { type: Date, required: true } }, opts);
supportFanoutSchema.index({ status: 1, createdAt: 1 }); supportFanoutSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
export const SupportFanout = model('SupportFanout', supportFanoutSchema);
export type UserDocument = InferSchemaType<typeof userSchema>;
