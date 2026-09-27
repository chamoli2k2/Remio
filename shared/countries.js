/**
 * Countries offered at checkout, with the dialling code that belongs to each one.
 *
 * The dialling code is derived from the country rather than typed, because a buyer who writes their
 * own prefix gets it wrong often enough to matter: a leading zero, a missing plus, or 91 written
 * twice. Picking the country is something they cannot get wrong, and the code follows from it.
 *
 * Not every country in the world is here. This is the list Razorpay can realistically collect from,
 * ordered so the markets that matter are reachable without scrolling.
 */
export const COUNTRIES = [
  { code: 'IN', name: 'India', dial: '+91' },
  { code: 'US', name: 'United States', dial: '+1' },
  { code: 'GB', name: 'United Kingdom', dial: '+44' },
  { code: 'CA', name: 'Canada', dial: '+1' },
  { code: 'AU', name: 'Australia', dial: '+61' },
  { code: 'AE', name: 'United Arab Emirates', dial: '+971' },
  { code: 'SG', name: 'Singapore', dial: '+65' },
  { code: 'DE', name: 'Germany', dial: '+49' },
  { code: 'FR', name: 'France', dial: '+33' },
  { code: 'NL', name: 'Netherlands', dial: '+31' },
  { code: 'IE', name: 'Ireland', dial: '+353' },
  { code: 'ES', name: 'Spain', dial: '+34' },
  { code: 'IT', name: 'Italy', dial: '+39' },
  { code: 'SE', name: 'Sweden', dial: '+46' },
  { code: 'CH', name: 'Switzerland', dial: '+41' },
  { code: 'PL', name: 'Poland', dial: '+48' },
  { code: 'PT', name: 'Portugal', dial: '+351' },
  { code: 'NZ', name: 'New Zealand', dial: '+64' },
  { code: 'JP', name: 'Japan', dial: '+81' },
  { code: 'KR', name: 'South Korea', dial: '+82' },
  { code: 'CN', name: 'China', dial: '+86' },
  { code: 'HK', name: 'Hong Kong', dial: '+852' },
  { code: 'MY', name: 'Malaysia', dial: '+60' },
  { code: 'ID', name: 'Indonesia', dial: '+62' },
  { code: 'PH', name: 'Philippines', dial: '+63' },
  { code: 'TH', name: 'Thailand', dial: '+66' },
  { code: 'VN', name: 'Vietnam', dial: '+84' },
  { code: 'BD', name: 'Bangladesh', dial: '+880' },
  { code: 'PK', name: 'Pakistan', dial: '+92' },
  { code: 'LK', name: 'Sri Lanka', dial: '+94' },
  { code: 'NP', name: 'Nepal', dial: '+977' },
  { code: 'SA', name: 'Saudi Arabia', dial: '+966' },
  { code: 'QA', name: 'Qatar', dial: '+974' },
  { code: 'KW', name: 'Kuwait', dial: '+965' },
  { code: 'OM', name: 'Oman', dial: '+968' },
  { code: 'BH', name: 'Bahrain', dial: '+973' },
  { code: 'IL', name: 'Israel', dial: '+972' },
  { code: 'TR', name: 'Turkey', dial: '+90' },
  { code: 'ZA', name: 'South Africa', dial: '+27' },
  { code: 'NG', name: 'Nigeria', dial: '+234' },
  { code: 'KE', name: 'Kenya', dial: '+254' },
  { code: 'EG', name: 'Egypt', dial: '+20' },
  { code: 'BR', name: 'Brazil', dial: '+55' },
  { code: 'MX', name: 'Mexico', dial: '+52' },
  { code: 'AR', name: 'Argentina', dial: '+54' },
  { code: 'CL', name: 'Chile', dial: '+56' },
  { code: 'NO', name: 'Norway', dial: '+47' },
  { code: 'DK', name: 'Denmark', dial: '+45' },
  { code: 'FI', name: 'Finland', dial: '+358' },
  { code: 'BE', name: 'Belgium', dial: '+32' },
  { code: 'AT', name: 'Austria', dial: '+43' },
  { code: 'CZ', name: 'Czechia', dial: '+420' },
  { code: 'GR', name: 'Greece', dial: '+30' },
  { code: 'RO', name: 'Romania', dial: '+40' },
  { code: 'UA', name: 'Ukraine', dial: '+380' },
];

export const DEFAULT_COUNTRY = 'IN';
export const COUNTRY_NAMES = COUNTRIES.map(c => c.name);
export const countryByCode = code => COUNTRIES.find(c => c.code === code) || null;
export const dialFor = code => countryByCode(code)?.dial || '';

/**
 * A phone number as it is stored and handed to the gateway: a dialling code then digits, no spaces
 * or punctuation. Loose on length because national numbering plans disagree, strict on shape.
 */
export const PHONE_PATTERN = /^\+[1-9]\d{6,17}$/;
export const composePhone = (code, national) => `${dialFor(code)}${String(national).replace(/\D/g, '')}`;
