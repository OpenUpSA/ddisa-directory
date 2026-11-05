export const REGIONS = new Set([
  'Southern Africa',
  'Eastern Africa',
  'Central Africa',
  'West Africa',
]);
export const COUNTRIES = new Set([
  'Angola',
  'Benin',
  'Botswana',
  'Burkina Faso',
  'Cameroon',
  'Central African Republic',
  'Chad',
  'Comoros',
  "Côte d'Ivoire",
  'Democratic Republic of the Congo',
  'Gabon',
  'Gambia',
  'Ghana',
  'Guinea',
  'Guinea Bissau',
  'Kenya',
  'Lesotho',
  'Liberia',
  'Madagascar',
  'Malawi',
  'Mali',
  'Mauritania',
  'Mauritius',
  'Mozambique',
  'Namibia',
  'Niger',
  'Nigeria',
  'Republic of the Congo',
  'Rwanda',
  'Senegal',
  'Sierra Leone',
  'Somalia',
  'Somaliland',
  'South Africa',
  'South Sudan',
  'Tanzania',
  'Togo',
  'Uganda',
  'Zambia',
  'Zimbabwe',
]);
export const CSO_TYPES = new Set([
  'LGBTIQ+ focused',
  'Marginalised communities',
  'Women-focused',
  'Youth-focused',
]);

export function cleanText(value, { label, min = 0, max = 5000, required = false }) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && text.length < Math.max(1, min)) {
    throw new Error(`${label} is required.`);
  }
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return text;
}

export function cleanEmail(value, required = false) {
  const email = cleanText(value, {
    label: 'Contact email',
    max: 254,
    required,
  }).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid contact email address.');
  }
  return email;
}

export function cleanUrl(value, label = 'URL', required = false) {
  const input = cleanText(value, { label, max: 2000, required });
  if (!input) return '';

  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return url.toString();
  } catch {
    throw new Error(`${label} must be a valid http or https address.`);
  }
}

export function cleanRegion(value) {
  const region = cleanText(value, { label: 'Region', max: 40, required: true });
  if (!REGIONS.has(region)) throw new Error('Choose a valid region.');
  return region;
}

export function cleanCountry(value) {
  const country = cleanText(value, { label: 'Country', max: 80, required: true });
  if (!COUNTRIES.has(country)) throw new Error('Choose a valid country.');
  return country;
}

export function cleanCsoTypes(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Select at least one type of CSO.');
  }
  const types = [...new Set(value.map((item) => cleanText(item, {
    label: 'Type of CSO',
    max: 80,
    required: true,
  })))];
  if (types.some((type) => !CSO_TYPES.has(type))) {
    throw new Error('Choose valid types of CSO.');
  }
  return types;
}

export function cleanOfferings(value) {
  if (value == null) return { tools: [], services: [] };
  if (typeof value !== 'object') {
    throw new Error('Offerings must be sent as an object containing tools and services.');
  }

  const cleanItems = (items, label) => {
    if (items == null) return [];
    if (!Array.isArray(items)) throw new Error(`${label} must be sent as a list.`);
    if (items.length > 50) throw new Error(`${label} can include up to 50 items.`);
    return items.map((item, index) => {
      if (!item || typeof item !== 'object') {
        throw new Error(`${label.slice(0, -1)} ${index + 1} is invalid.`);
      }
      return {
        name: cleanText(item.name, {
          label: `${label.slice(0, -1)} ${index + 1} name`,
          max: 180,
          required: true,
        }),
        description: cleanText(item.description, {
          label: `${label.slice(0, -1)} ${index + 1} description`,
          max: 800,
          required: true,
        }),
      };
    });
  };

  const tools = cleanItems(value.tools, 'Tools and platforms');
  const services = cleanItems(value.services, 'Services and programmes');
  if (tools.length + services.length > 50) {
    throw new Error('A submission can include up to 50 tools and services in total.');
  }
  return { tools, services };
}

export function cleanImage(image, label = 'Organisation photo') {
  if (!image || typeof image !== 'object') return null;
  const dataUrl = typeof image.dataUrl === 'string' ? image.dataUrl : '';
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error(`${label} must be a JPEG, PNG or WebP image.`);

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error(`${label} must be smaller than 5 MB.`);
  }

  return {
    contentType: match[1],
    base64: match[2],
    buffer,
    filename:
      cleanText(image.filename, { label: `${label} filename`, max: 120 }) ||
      `organisation-photo.${match[1].split('/')[1]}`,
  };
}

export function cleanResources(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('Additional resources must be sent as a list.');
  if (value.length > 50) throw new Error('A submission can include up to 50 additional resources.');

  return value.map((resource, index) => {
    if (!resource || typeof resource !== 'object') {
      throw new Error(`Resource ${index + 1} is invalid.`);
    }
    return {
      title: cleanText(resource.title, {
        label: `Resource ${index + 1} title`,
        max: 180,
        required: true,
      }),
      url: cleanUrl(resource.url, `Resource ${index + 1} link`, true),
      description: cleanText(resource.description, {
        label: `Resource ${index + 1} description`,
        max: 800,
      }),
    };
  });
}

export function cleanContacts(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('Additional contacts must be sent as a list.');
  if (value.length > 50) throw new Error('A submission can include up to 50 additional contacts.');

  return value.map((contact, index) => {
    if (!contact || typeof contact !== 'object') {
      throw new Error(`Contact ${index + 1} is invalid.`);
    }
    const type = cleanText(contact.type, {
      label: `Contact ${index + 1} type`,
      max: 20,
      required: true,
    });
    const common = {
      type,
      name: cleanText(contact.name, {
        label: `Contact ${index + 1} name`,
        max: 180,
        required: true,
      }),
    };

    if (type === 'Email') {
      return {
        ...common,
        email: cleanEmail(contact.email, true),
        role: cleanText(contact.role, {
          label: `Contact ${index + 1} role`,
          max: 120,
        }),
      };
    }

    if (type === 'Number') {
      const number = cleanText(contact.number, {
        label: `Contact ${index + 1} number`,
        max: 50,
        required: true,
      });
      if (!/^\+?[\d\s().-]{6,50}$/.test(number)) {
        throw new Error(`Contact ${index + 1} number must be a valid phone number.`);
      }
      return {
        ...common,
        number,
        role: cleanText(contact.role, {
          label: `Contact ${index + 1} role`,
          max: 120,
        }),
      };
    }

    if (type === 'Other') {
      return {
        ...common,
        url: cleanUrl(contact.url, `Contact ${index + 1} URL`, true),
        description: cleanText(contact.description, {
          label: `Contact ${index + 1} description`,
          max: 500,
        }),
      };
    }

    throw new Error(`Contact ${index + 1} type must be Email, Number or Other.`);
  });
}
