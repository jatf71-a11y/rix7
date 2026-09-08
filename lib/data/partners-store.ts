import { partners as initialPartners, Partner } from './partners';

// Mutable in-memory store — survives hot reloads in dev
let partnerList: Partner[] = [...initialPartners];

export function getAllPartners(): Partner[] {
  return [...partnerList];
}

export function getPartnerBySlugStore(slug: string): Partner | undefined {
  return partnerList.find((p) => p.slug === slug);
}

export function getPartnerByIdStore(id: string): Partner | undefined {
  return partnerList.find((p) => p.id === id);
}

export function addPartner(partner: Partner): Partner {
  partnerList.push(partner);
  return partner;
}

export function updatePartner(id: string, updates: Partial<Partner>): Partner | null {
  const idx = partnerList.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  partnerList[idx] = { ...partnerList[idx], ...updates };
  return partnerList[idx];
}

export function deletePartner(id: string): boolean {
  const idx = partnerList.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  partnerList.splice(idx, 1);
  return true;
}
