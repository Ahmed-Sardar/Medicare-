import bcrypt from 'bcryptjs';
import { connectDatabase } from './connect.js';
import { env } from '../config/env.js';
import { Inventory, InventoryBatch, Medicine, Notification, Pharmacist, Pharmacy, PharmacyStaff, Reservation, StockMovement, User } from '../modules/models.js';
import { logger } from '../config/logger.js';

const isRemove = process.argv.includes('--remove-demo');
async function run(): Promise<void> {
  if (!isRemove && (!env.DEMO_PASSWORD || env.DEMO_PASSWORD.length < 12)) throw new Error('Set DEMO_PASSWORD to a unique password of at least 12 characters before seeding demo records.');
  await connectDatabase();
  if (isRemove) {
    await Reservation.deleteMany({ isDemo: true }); await StockMovement.deleteMany({ isDemo: true }); await Notification.deleteMany({ isDemo: true }); await InventoryBatch.deleteMany({ isDemo: true });
    await Inventory.deleteMany({ isDemo: true }); await PharmacyStaff.deleteMany({ isDemo: true }); await Pharmacist.deleteMany({ isDemo: true }); await Pharmacy.deleteMany({ isDemo: true }); await Medicine.deleteMany({ isDemo: true }); await User.deleteMany({ isDemo: true });
    logger.info('Tagged MedFind demo records removed.'); return;
  }
  const passwordHash = await bcrypt.hash(env.DEMO_PASSWORD!, 12);
  async function demoUser(email: string, name: string, roles: string[]): Promise<any> {
    const existing = await User.findOne({ email }); if (existing && !existing.isDemo) throw new Error(`Refusing to overwrite non-demo account ${email}`);
    return (await User.findOneAndUpdate({ email }, { $set: { name, passwordHash, roles, active: true, emailVerifiedAt: new Date(), isDemo: true } }, { upsert: true, new: true, runValidators: true }))!;
  }
  const customers = await demoUser('demo.customer@example.test', 'DEMO Customer', ['CUSTOMER']);
  const staffUser = await demoUser('demo.staff@example.test', 'DEMO Pharmacy Staff', ['PHARMACY_STAFF']);
  const pharmacistUser = await demoUser('demo.pharmacist@example.test', 'DEMO Pharmacist (Pending Verification)', ['PHARMACIST']);
  const pharmacyLabels = ['DEMO — Banjara Hills', 'DEMO — Jubilee Hills', 'DEMO — Ameerpet', 'DEMO — Begumpet', 'DEMO — Somajiguda'];
  const pharmacyIds: string[] = []; const offsets: Array<[number, number]> = [[0, 0], [0.015, 0.01], [-0.012, 0.008], [0.02, -0.01], [-0.02, -0.012]];
  for (let index = 0; index < pharmacyLabels.length; index++) {
    const owner = await demoUser(`demo.owner${index + 1}@example.test`, `DEMO Pharmacy Owner ${index + 1}`, ['PHARMACY_OWNER']);
    const [longitudeOffset, latitudeOffset] = offsets[index]!;
    const pharmacy = (await Pharmacy.findOneAndUpdate({ name: pharmacyLabels[index], isDemo: true }, { $set: { name: pharmacyLabels[index], ownerId: owner.id, address: `DEMO address ${index + 1}, Hyderabad`, pinCode: '500034', city: 'Hyderabad', state: 'Telangana', location: { type: 'Point', coordinates: [env.DEMO_BASE_LNG + longitudeOffset, env.DEMO_BASE_LAT + latitudeOffset] }, phone: '+910000000000', verificationStatus: 'APPROVED', active: true, licenseNumber: 'DEMO-NOT-A-REAL-LICENCE', registeredPharmacistName: 'DEMO Pharmacist', isDemo: true } }, { upsert: true, new: true, runValidators: true }))!;
    pharmacyIds.push(pharmacy.id);
    await PharmacyStaff.updateOne({ pharmacyId: pharmacy.id, userId: owner.id }, { $set: { role: 'PHARMACY_OWNER', active: true, permissions: ['*'], isDemo: true } }, { upsert: true });
  }
  const pharmacistProfile = await Pharmacist.findOneAndUpdate({ userId: pharmacistUser.id }, { $set: { registrationNumber: 'DEMO-PENDING', council: 'DEMO Telangana State Pharmacy Council', verificationStatus: 'PENDING', pharmacyIds: [pharmacyIds[0]], isDemo: true } }, { upsert: true, new: true });
  await PharmacyStaff.updateOne({ pharmacyId: pharmacyIds[0], userId: pharmacistUser.id }, { $set: { role: 'PHARMACIST', active: true, permissions: [], isDemo: true } }, { upsert: true });
  await PharmacyStaff.updateOne({ pharmacyId: pharmacyIds[0], userId: staffUser.id }, { $set: { role: 'PHARMACY_STAFF', active: true, permissions: ['inventory:read', 'reservation:read'], isDemo: true } }, { upsert: true });
  const medicines = await Promise.all([
    { name: 'DEMO Paracetamol', brand: 'DEMO Paracetamol', genericName: 'Paracetamol', composition: 'Paracetamol', strength: '500 mg', dosageForm: 'Tablet', manufacturer: 'DEMO Manufacturer', packSize: '10 tablets', aliases: ['DEMO acetaminophen'] },
    { name: 'DEMO Cetirizine', brand: 'DEMO Cetirizine', genericName: 'Cetirizine', composition: 'Cetirizine hydrochloride', strength: '10 mg', dosageForm: 'Tablet', manufacturer: 'DEMO Manufacturer', packSize: '10 tablets', aliases: [] },
    { name: 'DEMO ORS', brand: 'DEMO ORS', genericName: 'Oral rehydration salts', composition: 'Oral rehydration salts', strength: 'WHO formula', dosageForm: 'Powder', manufacturer: 'DEMO Manufacturer', packSize: '1 sachet', aliases: ['DEMO oral rehydration'] },
  ].map((input) => Medicine.findOneAndUpdate({ name: input.name, isDemo: true }, { $set: { ...input, prescriptionClass: 'UNVERIFIED', active: true, isDemo: true } }, { upsert: true, new: true, runValidators: true })));
  for (const pharmacyId of pharmacyIds) for (let m = 0; m < medicines.length; m++) {
    const medicine = medicines[m]!; const inventory = (await Inventory.findOneAndUpdate({ pharmacyId, medicineId: medicine.id }, { $set: { active: true, stockStatus: 'AVAILABLE', verificationStatus: 'UNVERIFIED', lastUpdatedAt: new Date(), minStock: 5, isDemo: true } }, { upsert: true, new: true }))!;
    const expiryDates = [new Date(Date.now() + 25 * 86400000), new Date(Date.now() + 180 * 86400000)];
    for (let b = 0; b < 2; b++) {
      const batchNumber = `DEMO-${pharmacyId.slice(-4)}-${m + 1}-${b + 1}`;
      const batch = await InventoryBatch.findOneAndUpdate({ inventoryId: inventory.id, batchNumber }, { $set: { expiryDate: expiryDates[b], onHandQuantity: b === 0 ? 12 : 20, reservedQuantity: 0, sellingPrice: 24 + m * 13, mrp: 29 + m * 15, manufacturer: 'DEMO Manufacturer', active: true, isDemo: true } }, { upsert: true, new: true });
      const exists = await StockMovement.exists({ batchId: batch!.id, type: 'INITIAL_STOCK', isDemo: true }); if (!exists) await StockMovement.create({ pharmacyId, inventoryId: inventory.id, batchId: batch!.id, type: 'INITIAL_STOCK', quantity: batch!.onHandQuantity, note: 'DEMO DATA — not live stock', isDemo: true });
    }
  }
  await Reservation.updateOne({ customerId: customers.id, idempotencyKey: 'DEMO-REJECTED-EXAMPLE' }, { $setOnInsert: { customerId: customers.id, pharmacyId: pharmacyIds[0], medicineId: medicines[0]!.id, quantity: 1, status: 'REJECTED', allocatedBatches: [], history: [{ status: 'REJECTED', note: 'DEMO DATA — sample history only' }], idempotencyKey: 'DEMO-REJECTED-EXAMPLE', isDemo: true } }, { upsert: true });
  await Notification.updateOne({ dedupKey: 'DEMO:WELCOME' }, { $setOnInsert: { userId: customers.id, type: 'DEMO_WELCOME', title: 'DEMO DATA', message: 'This is sample activity. Demo availability is not live or pharmacy verified.', dedupKey: 'DEMO:WELCOME', isDemo: true } }, { upsert: true });
  logger.info({ demoPharmacies: pharmacyIds.length, demoMedicines: medicines.length, demoPharmacistStatus: pharmacistProfile?.verificationStatus }, 'MedFind demo data seeded. All records carry explicit demo labels.');
}
run().then(() => process.exit(0)).catch((error: unknown) => { logger.error({ err: error }, 'MedFind seeding failed'); process.exit(1); });
