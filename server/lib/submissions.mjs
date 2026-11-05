import {
  cleanCsoTypes,
  cleanContacts,
  cleanCountry,
  cleanEmail,
  cleanOfferings,
  cleanRegion,
  cleanResources,
  cleanText,
  cleanUrl,
} from './validation.mjs';

/**
 * Shared submission logic for the reference server and the Netlify
 * Functions. The front-end contract is identical in both.
 */

export function normaliseSubmission(body, access) {
  const requestType = access ? 'Profile update' : 'New organisation';
  const organisationName = access?.name || cleanText(body.organisationName, {
    label: 'Organisation name',
    min: 2,
    max: 180,
    required: true,
  });
  const contactEmail = cleanEmail(body.contactEmail, true);

  return {
    requestType,
    organisationId: access?.sub || '',
    organisationName,
    name: access?.name || cleanText(body.name || organisationName, {
      label: 'Organisation name',
      min: 2,
      max: 180,
      required: true,
    }),
    contactEmail,
    publicEmail: contactEmail,
    type: cleanCsoTypes(body.type),
    offerings: cleanOfferings(body.offerings),
    contacts: cleanContacts(body.contacts),
    country: access ? '' : cleanCountry(body.country),
    region: access ? '' : cleanRegion(body.region),
    website: cleanUrl(body.website, 'Website'),
    summary: cleanText(body.summary, {
      label: 'Card introduction',
      max: 240,
      required: true,
    }),
    description: cleanText(body.description, {
      label: 'Organisation description',
      max: 5000,
      required: true,
    }),
    collaboration: cleanText(body.collaboration, {
      label: 'Open for collaboration',
      max: 1200,
    }),
    resources: cleanResources(body.resources),
    photoAlt: cleanText(body.photoAlt, {
      label: 'Photo description',
      max: 180,
    }),
  };
}

export function normaliseCollaborationRequest(body) {
  return {
    recipientOrganisation: cleanText(body.recipientOrganisation, {
      label: 'Recipient organisation',
      max: 180,
      required: true,
    }),
    senderOrganisation: cleanText(body.senderOrganisation, {
      label: 'Your organisation',
      max: 180,
      required: true,
    }),
    senderName: cleanText(body.senderName, {
      label: 'Your name',
      max: 180,
      required: true,
    }),
    senderEmail: cleanEmail(body.senderEmail, true),
    collaborationType: cleanText(body.collaborationType, {
      label: 'Collaboration type',
      max: 100,
      required: true,
    }),
    message: cleanText(body.message, {
      label: 'Proposed collaboration',
      max: 2000,
      required: true,
    }),
    consentShared: body.consentShared === true,
  };
}

/**
 * Route a validated submission to the store:
 * - profile updates against a store with publishing support publish directly;
 * - new organisations publish directly (or go to the review queue if the
 *   store has no publishing support, e.g. the local preview store);
 * - otherwise the review-queue path is used.
 */
export async function handleSubmit(store, payload, photo, logo) {
  if (payload.organisationId && typeof store.publishProfileUpdate === 'function') {
    return store.publishProfileUpdate(payload.organisationId, payload, photo, logo);
  }
  if (!payload.organisationId && typeof store.publishNewOrganisation === 'function') {
    return store.publishNewOrganisation(payload, photo, logo);
  }
  return store.createSubmission(payload, photo, logo);
}
