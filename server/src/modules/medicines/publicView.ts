type Classification = { prescriptionClass?: string | null; classificationVerified?: boolean | null; classificationSource?: string | null; classificationReviewedAt?: Date | null; classificationReviewedBy?: unknown };
export function publicPrescriptionClass(medicine: Classification): string {
  return medicine.classificationVerified && medicine.classificationSource && medicine.classificationSource.trim().length >= 5 && medicine.classificationReviewedAt && medicine.classificationReviewedBy
    && ['OTC', 'PRESCRIPTION', 'CONTROLLED'].includes(medicine.prescriptionClass || '') ? medicine.prescriptionClass! : 'UNVERIFIED';
}
type MedicineSource = Classification & { _id: unknown; name: string; brand?: string | null; genericName?: string | null; composition?: string | null; strength: string; dosageForm: string;
  manufacturer?: string | null; packSize?: string | null; aliases?: string[]; isDemo?: boolean | null };
export function publicMedicine(medicine: MedicineSource, categories: Array<{ id: string; name: string }> = []) {
  const prescriptionClass = publicPrescriptionClass(medicine);
  return { _id: String(medicine._id), name: medicine.name, brand: medicine.brand || '', genericName: medicine.genericName || '', composition: medicine.composition || '',
    strength: medicine.strength, dosageForm: medicine.dosageForm, manufacturer: medicine.manufacturer || '', packSize: medicine.packSize || '', aliases: medicine.aliases || [], categories,
    prescriptionClass, classificationVerified: prescriptionClass !== 'UNVERIFIED', ...(prescriptionClass !== 'UNVERIFIED' ? { classificationSource: medicine.classificationSource, classificationReviewedAt: medicine.classificationReviewedAt } : {}), isDemo: Boolean(medicine.isDemo) };
}
